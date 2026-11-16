/**
 * Free Games - Cloud Functions
 * -----------------------------------------------------------
 * كل قيمة تتعلق بالنقاط أو حالة الحظر أو نتائج العجلة تُحسم هنا فقط،
 * على خوادم Firebase (منصتك)، وليس على جهاز المستخدم. هذا هو العزل
 * الحقيقي الذي يمنع أي تلاعب من طرف العميل، بغض النظر عما يعدّله
 * أي شخص في كود التطبيق نفسه.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function requireAuth(context){
  if(!context.auth) throw new functions.https.HttpsError('unauthenticated','يجب تسجيل الدخول');
  return context.auth.uid;
}
function requireAdmin(context){
  if(!context.auth || context.auth.token.admin !== true){
    throw new functions.https.HttpsError('permission-denied','صلاحيات غير كافية');
  }
}
async function requireNotBanned(uid){
  const snap = await db.collection('users').doc(uid).get();
  const d = snap.data() || {};
  if(d.banned){
    throw new functions.https.HttpsError('permission-denied','حسابك مقيد حاليا، تواصل مع الدعم');
  }
  return d;
}
function todayKey(){ return new Date().toISOString().slice(0,10); }

async function flagSuspicious(uid, reason, tempBanMinutes){
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const name = (userSnap.data()||{}).name || uid;
  const update = { flagged: true };
  if(tempBanMinutes){
    update.banned = true;
    update.bannedUntil = admin.firestore.Timestamp.fromMillis(Date.now() + tempBanMinutes*60000);
  }
  await userRef.set(update, {merge:true});
  await db.collection('alerts').add({
    uid, userName: name, reason,
    bannedUntil: update.bannedUntil || null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/* ================= WHEEL ================= */
exports.spinWheel = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  await requireNotBanned(uid);

  const userRef = db.collection('users').doc(uid);
  const wheelSnap = await db.collection('config').doc('wheel').get();
  const prizes = (wheelSnap.data()||{}).prizes;
  if(!prizes || !prizes.length) throw new functions.https.HttpsError('failed-precondition','العجلة غير مُعدة بعد');

  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const u = userSnap.data() || {};
    const now = admin.firestore.Timestamp.now();
    if(u.nextSpinAt && u.nextSpinAt.toMillis() > now.toMillis()){
      const remainMs = u.nextSpinAt.toMillis() - now.toMillis();
      const h = Math.floor(remainMs/3600000), m = Math.floor((remainMs%3600000)/60000);
      throw new functions.https.HttpsError('resource-exhausted', `اللفة القادمة بعد ${h} ساعة و${m} دقيقة`);
    }
    // اختيار عشوائي موزون حسب نسبة الظهور - على الخادم فقط
    const totalWeight = prizes.reduce((s,p)=> s + (p.weight||1), 0);
    let r = Math.random() * totalWeight;
    let index = 0;
    for(let i=0;i<prizes.length;i++){
      r -= (prizes[i].weight||1);
      if(r <= 0){ index = i; break; }
    }
    const prize = prizes[index];
    const nextSpinAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 24*3600000);
    tx.set(userRef, {
      points: FieldValue.increment(prize.points||0),
      nextSpinAt,
    }, {merge:true});
    tx.set(userRef.collection('activity').doc(), {
      type:'spin', prizeLabel: prize.label, points: prize.points, createdAt: now,
    });
    return { index, prize };
  });
});

exports.adminSetWheelConfig = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  if(!Array.isArray(data.prizes) || data.prizes.length !== 12){
    throw new functions.https.HttpsError('invalid-argument','يجب توفير 12 خانة بالضبط');
  }
  await db.collection('config').doc('wheel').set({ prizes: data.prizes });
  return { ok:true };
});

/* ================= ADS ================= */
exports.claimAdReward = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  await requireNotBanned(uid);

  const cfgSnap = await db.collection('config').doc('adConfig').get();
  const cfg = cfgSnap.data() || { pointsPerAd:50, dailyCap:40, minGapSeconds:15 };
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const u = snap.data() || {};
    const now = admin.firestore.Timestamp.now();
    const key = todayKey();
    const countToday = (u.adCountByDay && u.adCountByDay[key]) || 0;

    if(countToday >= cfg.dailyCap){
      throw new functions.https.HttpsError('resource-exhausted','وصلت للحد الأقصى اليومي من الإعلانات');
    }
    if(u.lastAdAt){
      const gapSec = (now.toMillis() - u.lastAdAt.toMillis())/1000;
      if(gapSec < cfg.minGapSeconds){
        // محاولة مشاهدة إعلانات أسرع من الممكن فعليا = نمط آلي (ماكرو)
        const strikes = (u.adStrikeCount||0) + 1;
        if(strikes >= 3){
          tx.set(userRef, { adStrikeCount:0 }, {merge:true});
          flagSuspicious(uid, 'نمط نقر آلي مشبوه على زر مشاهدة الإعلانات', 60);
          throw new functions.https.HttpsError('permission-denied','تم رصد نشاط غير طبيعي، تم تقييد الحساب لمدة ساعة');
        }
        tx.set(userRef, { adStrikeCount: strikes }, {merge:true});
        throw new functions.https.HttpsError('resource-exhausted','الرجاء الانتظار قليلا قبل إعلان آخر');
      }
    }
    tx.set(userRef, {
      points: FieldValue.increment(cfg.pointsPerAd),
      lastAdAt: now,
      adStrikeCount: 0,
      [`adCountByDay.${key}`]: countToday + 1,
      adsWatchedTotal: FieldValue.increment(1),
    }, {merge:true});
    tx.set(userRef.collection('activity').doc(), {
      type:'ad', points: cfg.pointsPerAd, createdAt: now,
    });
    return { rewarded: cfg.pointsPerAd };
  });
});

exports.adminSetAdConfig = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  await db.collection('config').doc('adConfig').set({
    pointsPerAd: Number(data.pointsPerAd)||0,
    dailyCap: Number(data.dailyCap)||0,
    minGapSeconds: Number(data.minGapSeconds)||10,
  });
  return { ok:true };
});

/* ================= CATALOG / REDEMPTION ================= */
exports.adminSetCatalog = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  await db.collection('config').doc('catalog').set({ games: data.games || [] });
  return { ok:true };
});

exports.createRedemption = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const u = await requireNotBanned(uid);
  const { gameId, itemId, playerId, note } = data;
  if(!playerId) throw new functions.https.HttpsError('invalid-argument','ID اللاعب مطلوب');

  const catalogSnap = await db.collection('config').doc('catalog').get();
  const games = (catalogSnap.data()||{}).games || [];
  const game = games.find(g=>g.id===gameId);
  const item = game && (game.items||[]).find(i=>i.id===itemId);
  if(!item) throw new functions.https.HttpsError('not-found','هذا العرض لم يعد متاحا');

  const userRef = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const cur = snap.data() || {};
    if((cur.points||0) < item.cost){
      throw new functions.https.HttpsError('failed-precondition','رصيدك غير كافٍ');
    }
    tx.set(userRef, { points: FieldValue.increment(-item.cost) }, {merge:true});
    const redemptionRef = db.collection('redemptions').doc();
    tx.set(redemptionRef, {
      uid, userName: cur.name || '', gameId, gameName: game.name,
      itemId, itemLabel: item.label, cost: item.cost,
      playerId, note: note||'', status:'pending', seen:false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok:true };
  });
});

exports.approveRedemption = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  await db.collection('redemptions').doc(data.id).set({
    status:'approved', adminNote: data.note||'', resolvedAt: FieldValue.serverTimestamp(),
  }, {merge:true});
  return { ok:true };
});

exports.rejectRedemption = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const ref = db.collection('redemptions').doc(data.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const r = snap.data();
    if(!r) throw new functions.https.HttpsError('not-found','الطلب غير موجود');
    // استرداد النقاط للمستخدم عند الرفض
    tx.set(db.collection('users').doc(r.uid), { points: FieldValue.increment(r.cost) }, {merge:true});
    tx.set(ref, { status:'rejected', adminNote: data.note||'', resolvedAt: FieldValue.serverTimestamp() }, {merge:true});
    return { ok:true };
  });
});

exports.markRedemptionSeen = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const ref = db.collection('redemptions').doc(data.id);
  const snap = await ref.get();
  if(snap.exists && snap.data().uid === uid){
    await ref.set({ seen:true }, {merge:true});
  }
  return { ok:true };
});

/* ================= USERS / ANTI-CHEAT ================= */
exports.setUserBan = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  await db.collection('users').doc(data.uid).set({
    banned: !!data.banned, bannedUntil: null, flagged: false,
  }, {merge:true});
  return { ok:true };
});

exports.extendBan = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  await db.collection('users').doc(data.uid).set({
    banned:true, bannedUntil: admin.firestore.Timestamp.fromMillis(Date.now()+3600000),
  }, {merge:true});
  return { ok:true };
});

// فك الحظر المؤقت تلقائيا بعد انتهاء مدته
exports.autoUnban = functions.pubsub.schedule('every 5 minutes').onRun(async () => {
  const now = admin.firestore.Timestamp.now();
  const qs = await db.collection('users').where('bannedUntil','<=', now).get();
  const batch = db.batch();
  qs.forEach(doc => batch.set(doc.ref, { banned:false, bannedUntil:null }, {merge:true}));
  await batch.commit();
  return null;
});

/* ================= TOURNAMENTS ================= */
exports.adminSaveTournament = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const payload = {
    title: data.title || 'بطولة',
    imageUrl: data.imageUrl || '',
    prizeAmount: Number(data.prizeAmount)||0,
    roomId: data.roomId || '',
    status: data.roomId ? 'active' : 'countdown',
  };
  if(data.endInMs){
    payload.endAt = admin.firestore.Timestamp.fromMillis(Date.now() + Number(data.endInMs));
  }
  if(data.id){
    await db.collection('tournaments').doc(data.id).set(payload, {merge:true});
    return { id: data.id };
  } else {
    payload.createdAt = FieldValue.serverTimestamp();
    const ref = await db.collection('tournaments').add(payload);
    return { id: ref.id };
  }
});

exports.adminDeleteTournament = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  await db.collection('tournaments').doc(data.id).delete();
  return { ok:true };
});

// فحص دوري: إذا انتهى العد التنازلي ولم يضع المطور معرف غرفة، أعلن خطأ تقني
exports.checkTournaments = functions.pubsub.schedule('every 5 minutes').onRun(async () => {
  const now = admin.firestore.Timestamp.now();
  const qs = await db.collection('tournaments')
    .where('status','==','countdown').where('endAt','<=', now).get();
  const batch = db.batch();
  qs.forEach(doc => {
    const t = doc.data();
    batch.set(doc.ref, { status: t.roomId ? 'active' : 'technical_error' }, {merge:true});
  });
  await batch.commit();
  return null;
});

/* ================= SUPPORT CHAT ================= */
exports.sendSupportMessage = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const userSnap = await db.collection('users').doc(uid).get();
  const name = (userSnap.data()||{}).name || '';
  const ref = db.collection('supportChats').doc(uid);
  await ref.set({ userName: name, lastMessageAt: FieldValue.serverTimestamp() }, {merge:true});
  await ref.collection('messages').add({
    from:'user', text: String(data.text||'').slice(0,1000), userName:name,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok:true };
});

exports.adminReplySupport = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  await db.collection('supportChats').doc(data.uid).collection('messages').add({
    from:'dev', text: String(data.text||'').slice(0,1000),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok:true };
});

exports.deleteSupportThread = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const msgsRef = db.collection('supportChats').doc(data.uid).collection('messages');
  const qs = await msgsRef.get();
  const batch = db.batch();
  qs.forEach(doc => batch.delete(doc.ref));
  batch.delete(db.collection('supportChats').doc(data.uid));
  await batch.commit();
  return { ok:true };
});
