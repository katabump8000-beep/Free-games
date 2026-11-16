/* =========================================================
   Free Games - Client App
   ملاحظة أمان مهمة: كل عملية تغيّر نقاط أو تحسم طلب استبدال
   تمر حصرا عبر Cloud Functions (functions/index.js). هذا الملف
   لا يكتب نقاطا مباشرة أبدا، وقواعد Firestore تمنع ذلك أصلا.
   ========================================================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentUser = null;
let isAdmin = false;
let userDocUnsub = null;
let wheelConfig = null;
let catalogData = { games: [] };
let activeRedemption = null;

function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.style.display='none', 2600);
}

/* ---------------- THEMES ---------------- */
const THEMES = [
  {name:'أحمر دم', red:'#c4172c', maroon:'#4b0e14', gold:'#d8a53d'},
  {name:'ياقوتي', red:'#e0203f', maroon:'#3a0a16', gold:'#f0c14b'},
  {name:'خمري', red:'#9c1c3a', maroon:'#2e0a14', gold:'#c9a24a'},
  {name:'برتقالي ناري', red:'#d9502b', maroon:'#3a1206', gold:'#e8b23a'},
  {name:'ذهبي داكن', red:'#b8860b', maroon:'#2a1c04', gold:'#f3d27a'},
  {name:'أرجواني ليلي', red:'#8e1e6b', maroon:'#260a1e', gold:'#d8a53d'},
  {name:'أزرق فولاذي', red:'#1e5fa8', maroon:'#07192e', gold:'#9fcBea'},
  {name:'أخضر سام', red:'#1e8e4f', maroon:'#07200f', gold:'#bfe08a'},
  {name:'رمادي فحمي', red:'#555b63', maroon:'#121416', gold:'#cfd6dc'},
];
function applyTheme(i){
  const t = THEMES[i]; if(!t) return;
  document.documentElement.style.setProperty('--red', t.red);
  document.documentElement.style.setProperty('--maroon', t.maroon);
  document.documentElement.style.setProperty('--red-dark', t.red);
  document.documentElement.style.setProperty('--gold', t.gold);
  localStorage.setItem('fg_theme', i);
}
function buildThemeGrid(){
  const grid = $('#themeGrid'); grid.innerHTML='';
  THEMES.forEach((t,i)=>{
    const d = document.createElement('div');
    d.className='theme-dot'+(String(i)===localStorage.getItem('fg_theme')?' sel':'');
    d.style.background = `linear-gradient(135deg, ${t.red}, ${t.maroon})`;
    d.onclick = ()=>{ applyTheme(i); buildThemeGrid(); };
    grid.appendChild(d);
  });
}
(function initTheme(){
  const saved = localStorage.getItem('fg_theme');
  if(saved!==null) applyTheme(parseInt(saved));
  const fs = localStorage.getItem('fg_fontsize');
  if(fs) document.documentElement.style.fontSize = fs+'px';
})();

/* ---------------- BACKGROUND FX (lightweight embers) ---------------- */
(function bgfx(){
  const c = $('#bgfx'); const ctx = c.getContext('2d');
  function resize(){ c.width = innerWidth; c.height = innerHeight; }
  resize(); addEventListener('resize', resize);
  const parts = Array.from({length:40}, ()=>({
    x: Math.random()*innerWidth, y: Math.random()*innerHeight+innerHeight,
    r: Math.random()*2+0.6, s: Math.random()*0.6+0.2, o: Math.random()*0.5+0.1
  }));
  function loop(){
    ctx.clearRect(0,0,c.width,c.height);
    ctx.fillStyle = 'rgba(196,23,44,0.9)';
    parts.forEach(p=>{
      p.y -= p.s; if(p.y < -10){ p.y = innerHeight+10; p.x = Math.random()*innerWidth; }
      ctx.globalAlpha = p.o;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,7); ctx.fill();
    });
    requestAnimationFrame(loop);
  }
  loop();
})();

/* ---------------- NAV ---------------- */
function showView(v){
  $$('.view').forEach(x=>x.classList.remove('active'));
  $('#view-'+v)?.classList.add('active');
  $$('.bn-item').forEach(x=>x.classList.toggle('active', x.dataset.v===v));
  if(v==='admin') loadAdminData();
  if(v==='redeem') renderRedeemView();
  if(v==='tours') {} // live listener already running
}
$('#bottomNav').addEventListener('click', (e)=>{
  const item = e.target.closest('.bn-item'); if(!item) return;
  showView(item.dataset.v);
});

/* ---------------- AUTH ---------------- */
let authMode = 'login';
$('#authSwitchMode').onclick = ()=>{
  authMode = authMode==='login' ? 'signup' : 'login';
  $('#authTitle').textContent = authMode==='login' ? 'تسجيل الدخول' : 'إنشاء حساب';
  $('#authNameWrap').style.display = authMode==='signup' ? 'block' : 'none';
  $('#authSwitchMode').textContent = authMode==='login' ? 'ليس لدي حساب؟ إنشاء حساب' : 'لدي حساب بالفعل؟ دخول';
};
$('#authNameWrap').style.display='none';

$('#authSubmitBtn').onclick = async ()=>{
  const email = $('#authEmail').value.trim();
  const pass = $('#authPass').value;
  const name = $('#authName').value.trim();
  $('#authErr').textContent = '';
  try{
    if(authMode==='signup'){
      if(!name){ $('#authErr').textContent = 'الاسم مطلوب'; return; }
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      await db.collection('users').doc(cred.user.uid).set({
        name, email, points:0, banned:false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await auth.signInWithEmailAndPassword(email, pass);
    }
  }catch(err){
    $('#authErr').textContent = translateAuthErr(err.code);
  }
};
function translateAuthErr(code){
  const map = {
    'auth/email-already-in-use':'هذا البريد مستخدم مسبقا',
    'auth/invalid-email':'بريد إلكتروني غير صالح',
    'auth/weak-password':'كلمة المرور ضعيفة جدا (6 أحرف على الأقل)',
    'auth/wrong-password':'كلمة المرور غير صحيحة',
    'auth/user-not-found':'الحساب غير موجود',
    'auth/invalid-credential':'بيانات الدخول غير صحيحة',
  };
  return map[code] || 'حدث خطأ، حاول مجددا';
}
$('#logoutBtn').onclick = ()=> auth.signOut();

auth.onAuthStateChanged(async (user)=>{
  if(userDocUnsub) { userDocUnsub(); userDocUnsub=null; }
  if(!user){
    currentUser = null; isAdmin = false;
    $('#authModal').classList.add('show');
    $('#adminNavItem').style.display='none';
    return;
  }
  currentUser = user;
  $('#authModal').classList.remove('show');
  $('#accountEmailLbl').textContent = user.email;

  const tok = await user.getIdTokenResult(true);
  isAdmin = !!tok.claims.admin;
  $('#adminNavItem').style.display = isAdmin ? 'flex' : 'none';

  userDocUnsub = db.collection('users').doc(user.uid).onSnapshot(snap=>{
    const d = snap.data() || {};
    $('#userNameLbl').textContent = d.name || user.email.split('@')[0];
    $('#pointsLbl').textContent = (d.points||0).toLocaleString('ar');
    updateWheelFab(d);
    renderAdStats(d);
    if(d.banned){
      toast('تم تقييد حسابك مؤقتا بسبب نشاط مشبوه، تواصل مع الدعم');
    }
  });

  listenCatalog();
  listenWheelConfig();
  listenTournaments();
  listenActiveRedemption();
  listenChat();
});

/* ---------------- DEV GATE (UI gate only — real security is server-side custom claims) ---------------- */
let devTapCount = 0; let devTapTimer = null;
$('#devHit').addEventListener('click', ()=>{
  devTapCount++;
  clearTimeout(devTapTimer);
  devTapTimer = setTimeout(()=> devTapCount=0, 2000);
  if(devTapCount >= 22){
    devTapCount = 0;
    $('#devGateModal').classList.add('show');
  }
});
$$('[data-close]').forEach(b=> b.onclick = (e)=> e.target.closest('.modal-bg').classList.remove('show'));

$('#devPassSubmit').onclick = ()=>{
  if($('#devPassInput').value === 'Itachi8000'){
    $('#devGateModal').classList.remove('show');
    $('#devPassInput').value='';
    $('#devGateErr').textContent='';
    // just reveal a normal login prompt; actual admin access is granted
    // server-side via Firebase custom claims set by the project owner.
    if(!currentUser){
      $('#authModal').classList.add('show');
    } else if(isAdmin){
      showView('admin');
    } else {
      toast('هذا الحساب غير مخول كمطور');
    }
  } else {
    $('#devGateErr').textContent = 'كلمة سر خاطئة';
  }
};

/* ---------------- ADS ---------------- */
$('#adBtn').onclick = async ()=>{
  const cfg = window.__adConfig || {pointsPerAd:50};
  toast(`جاري تحميل إعلان مقابل ${cfg.pointsPerAd} نقطة...`);
  // ======================================================
  // نقطة ربط شبكة الإعلانات الحقيقية (AdMob / Unity Ads / IronSource):
  // استدعِ هنا SDK الإعلانات الخاص بالمنصة (ويب/أندرويد عبر Capacitor plugin)
  // ولا تستدعِ claimAdReward إلا من داخل callback "onAdCompleted" الحقيقي،
  // ويفضل أيضا تفعيل Server-Side Verification من لوحة شبكة الإعلانات نفسها
  // بحيث يرسل سيرفر الإعلانات تأكيدا مباشرا لسيرفرك، بدل الاعتماد فقط
  // على تأكيد الجهاز. هذا يمنع تزييف "مشاهدة الإعلان" تماما.
  // ======================================================
  try{
    const result = await fx.httpsCallable('claimAdReward')();
    toast(`+${result.data.rewarded} نقطة! شكرا لمشاهدتك`);
  }catch(err){
    toast(err.message || 'تعذر إكمال العملية الآن');
  }
};
function renderAdStats(d){
  const today = new Date().toISOString().slice(0,10);
  const count = (d.adCountByDay && d.adCountByDay[today]) || 0;
  $('#adStatsLbl').textContent = `شاهدت ${count} إعلانا اليوم`;
}
db.collection('config').doc('adConfig').onSnapshot(s=>{
  window.__adConfig = s.data() || {pointsPerAd:50};
  $('#adRewardSub').textContent = `مقابل ${window.__adConfig.pointsPerAd} نقطة`;
});

/* ---------------- WHEEL ---------------- */
function listenWheelConfig(){
  db.collection('config').doc('wheel').onSnapshot(s=>{
    wheelConfig = s.data() || {prizes: defaultPrizes()};
    drawWheel();
  });
}
function defaultPrizes(){
  const colors=['#c4172c','#7a0f1c','#d8a53d','#9c1c3a','#4b0e14','#e0203f','#b8860b','#8e1e6b','#1e5fa8','#1e8e4f','#555b63','#3a0509'];
  return Array.from({length:12},(_,i)=>({label:`${(i+1)*10} نقطة`, points:(i+1)*10, weight:10, color:colors[i]}));
}
function drawWheel(){
  const svg = $('#wheelSvg'); svg.innerHTML='';
  const prizes = (wheelConfig && wheelConfig.prizes) || defaultPrizes();
  const n = prizes.length, cx=100, cy=100, r=96, step = 2*Math.PI/n;
  prizes.forEach((p,i)=>{
    const a0 = i*step - Math.PI/2, a1 = (i+1)*step - Math.PI/2;
    const x0 = cx + r*Math.cos(a0), y0 = cy + r*Math.sin(a0);
    const x1 = cx + r*Math.cos(a1), y1 = cy + r*Math.sin(a1);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', `M${cx},${cy} L${x0},${y0} A${r},${r} 0 0,1 ${x1},${y1} Z`);
    path.setAttribute('fill', p.color || '#7a0f1c');
    path.setAttribute('stroke', '#1a0606'); path.setAttribute('stroke-width','1');
    svg.appendChild(path);
    const amid = (a0+a1)/2, tx = cx + (r*0.62)*Math.cos(amid), ty = cy + (r*0.62)*Math.sin(amid);
    const text = document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('x', tx); text.setAttribute('y', ty);
    text.setAttribute('fill', '#fff'); text.setAttribute('font-size','8');
    text.setAttribute('text-anchor','middle');
    text.setAttribute('transform', `rotate(${(amid*180/Math.PI)+90}, ${tx}, ${ty})`);
    text.textContent = p.label;
    svg.appendChild(text);
  });
}
function updateWheelFab(userData){
  const ready = userData.nextSpinAt ? (userData.nextSpinAt.toMillis ? userData.nextSpinAt.toMillis() < Date.now() : true) : true;
  $('#wheelFab').classList.toggle('ready', ready);
}
$('#wheelFab').onclick = ()=>{ $('#wheelModal').classList.add('show'); drawWheel(); };
$('#spinBtn').onclick = async ()=>{
  $('#spinBtn').disabled = true;
  $('#wheelCooldownLbl').textContent='';
  try{
    const res = await fx.httpsCallable('spinWheel')();
    const { index, prize } = res.data;
    const n = (wheelConfig.prizes||defaultPrizes()).length;
    const step = 360/n;
    const targetDeg = 360*6 - (index*step + step/2);
    $('#wheelSvg').style.transform = `rotate(${targetDeg}deg)`;
    setTimeout(()=>{
      toast(`مبروك! ربحت ${prize.label}`);
      $('#spinBtn').disabled = false;
    }, 4600);
  }catch(err){
    $('#wheelCooldownLbl').textContent = err.message || 'حاول لاحقا';
    $('#spinBtn').disabled = false;
  }
};

/* ---------------- CATALOG / REDEEM ---------------- */
function listenCatalog(){
  db.collection('config').doc('catalog').onSnapshot(s=>{
    catalogData = s.data() || {games:[]};
    renderRedeemView();
  });
}
function renderRedeemView(){
  const box = $('#redeemCatalog'); const pending = $('#redeemPendingBox');
  if(activeRedemption){
    box.style.display='none'; pending.style.display='block';
    if(activeRedemption.status==='approved'){
      $('#pendingTitle').textContent = 'تم تحويل الجواهر إلى حسابك ✅';
      pending.querySelector('.s').textContent = activeRedemption.adminNote || 'شكرا لاستخدامك Free Games';
    } else if(activeRedemption.status==='rejected'){
      $('#pendingTitle').textContent = 'تم رفض عملية الشراء';
      pending.querySelector('.s').textContent = activeRedemption.adminNote || 'تواصل مع الدعم لمزيد من التفاصيل';
    } else {
      $('#pendingTitle').textContent = 'تم إرسال طلبك إلى المطورين';
      pending.querySelector('.s').textContent = 'يجري التحقق منه والرد عليك خلال أقل من 4 ساعات. نضمن لك وصول جواهرك في أقرب وقت ممكن.';
    }
    return;
  }
  pending.style.display='none'; box.style.display='flex';
  box.innerHTML='';
  (catalogData.games||[]).forEach(game=>{
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `<h3>${game.name}</h3>`;
    const rows = document.createElement('div');
    (game.items||[]).forEach(item=>{
      const row = document.createElement('div'); row.className='shop-row';
      row.innerHTML = `<div class="l"><b>${item.label}</b><br>${item.cost.toLocaleString('ar')} نقطة</div>`;
      const btn = document.createElement('button'); btn.textContent='استبدال';
      btn.onclick = ()=> startRedeem(game, item);
      row.appendChild(btn); rows.appendChild(row);
    });
    card.appendChild(rows); box.appendChild(card);
  });
  if(!catalogData.games || !catalogData.games.length){
    box.innerHTML = '<div class="card" style="text-align:center; color:var(--text-dim);">لا توجد عروض متاحة حاليا</div>';
  }
}
function startRedeem(game, item){
  const pid = prompt(`أدخل ID الخاص بك في ${game.name}:`);
  if(!pid) return;
  const note = prompt('رسالة أو ملاحظة إضافية (اختياري):') || '';
  fx.httpsCallable('createRedemption')({gameId: game.id, itemId: item.id, playerId: pid, note})
    .then(()=> toast('تم إرسال طلبك'))
    .catch(err=> toast(err.message || 'رصيدك غير كافٍ'));
}
function listenActiveRedemption(){
  db.collection('redemptions')
    .where('uid','==', currentUser.uid)
    .where('seen','==', false)
    .limit(1)
    .onSnapshot(qs=>{
      if(qs.empty){ activeRedemption = null; }
      else {
        const doc = qs.docs[0]; activeRedemption = {id:doc.id, ...doc.data()};
        if(activeRedemption.status !== 'pending' && !activeRedemption.__timerSet){
          activeRedemption.__timerSet = true;
          setTimeout(()=> fx.httpsCallable('markRedemptionSeen')({id: doc.id}), 120000);
        }
      }
      renderRedeemView();
    });
}

/* ---------------- TOURNAMENTS ---------------- */
function listenTournaments(){
  db.collection('tournaments').orderBy('createdAt','desc').onSnapshot(qs=>{
    const list = $('#toursList'); list.innerHTML='';
    qs.forEach(doc=>{
      const t = doc.data();
      const card = document.createElement('div'); card.className='tour-card';
      card.style.backgroundImage = t.imageUrl ? `url(${t.imageUrl})` : 'none';
      card.style.background = t.imageUrl ? undefined : 'linear-gradient(135deg,#3a0509,#160505)';
      let timerHtml = '';
      const endMs = t.endAt ? t.endAt.toMillis() : 0;
      if(t.status === 'technical_error'){
        timerHtml = `<div class="timer" style="color:#ff8585;">خطأ تقني في البطولة</div><div style="font-size:12px;">سيتم مراجعة هذه البطولة من قبل أحد المطورين.</div>`;
      } else if(endMs && endMs <= Date.now() && !t.roomId){
        timerHtml = `<div class="timer">جاري إنشاء البطولة...</div>`;
      } else if(t.roomId){
        timerHtml = `<div class="timer">بدأت البطولة • معرف الغرفة: ${t.roomId}</div>`;
      } else if(endMs){
        timerHtml = `<div class="timer" data-end="${endMs}">--</div>`;
      }
      card.innerHTML = `<div class="prize">🏆 ${(t.prizeAmount||0).toLocaleString('ar')} توكن</div>
        <div class="title">${t.title||'بطولة'}</div>${timerHtml}`;
      list.appendChild(card);
    });
  });
}
setInterval(()=>{
  $$('.tour-card .timer[data-end]').forEach(el=>{
    const end = parseInt(el.dataset.end);
    let diff = Math.max(0, end - Date.now());
    const d = Math.floor(diff/86400000); diff%=86400000;
    const h = Math.floor(diff/3600000); diff%=3600000;
    const m = Math.floor(diff/60000); diff%=60000;
    const s = Math.floor(diff/1000);
    el.textContent = diff<=0 ? 'جاري إنشاء البطولة...' : `${d} يوم ${h} ساعة ${m} دقيقة ${s} ثانية`;
  });
}, 1000);

/* ---------------- SETTINGS ---------------- */
buildThemeGrid();
$('#fontRange').value = localStorage.getItem('fg_fontsize') || 15;
$('#fontRange').oninput = (e)=>{
  document.documentElement.style.fontSize = e.target.value+'px';
  localStorage.setItem('fg_fontsize', e.target.value);
};

/* ---------------- SUPPORT CHAT ---------------- */
$('#openSupportBtn').onclick = ()=> $('#supportModal').classList.add('show');
function listenChat(){
  db.collection('supportChats').doc(currentUser.uid).collection('messages').orderBy('createdAt')
    .onSnapshot(qs=>{
      const box = $('#chatBox'); box.innerHTML='';
      qs.forEach(doc=>{
        const m = doc.data();
        const div = document.createElement('div');
        div.className = 'msg ' + (m.from==='dev' ? 'dev' : 'me');
        div.textContent = m.text;
        box.appendChild(div);
      });
      box.scrollTop = box.scrollHeight;
    });
}
$('#chatSendBtn').onclick = ()=>{
  const v = $('#chatInput').value.trim(); if(!v) return;
  fx.httpsCallable('sendSupportMessage')({text: v});
  $('#chatInput').value='';
};

/* =========================================================
   ADMIN PANEL
   ========================================================= */
$$('.btn-tab').forEach(btn=>{
  btn.onclick = ()=>{
    $$('.btn-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    $$('.admin-section').forEach(s=>s.classList.remove('active'));
    $('#ad-'+btn.dataset.a).classList.add('active');
  };
});

function loadAdminData(){
  loadWheelEditor();
  loadAdSettings();
  loadCatalogEditor();
  loadRequests();
  loadTopUsers();
  loadAlerts();
  loadToursAdmin();
  loadSupportThreads();
}

function loadWheelEditor(){
  const prizes = (wheelConfig && wheelConfig.prizes) || defaultPrizes();
  const wrap = $('#wheelEditor'); wrap.innerHTML='';
  prizes.forEach((p,i)=>{
    const row = document.createElement('div'); row.style.marginBottom='10px';
    row.innerHTML = `
      <label>الخانة ${i+1}</label>
      <div class="row2">
        <input data-f="label" data-i="${i}" value="${p.label}" placeholder="اسم الجائزة">
        <input data-f="points" data-i="${i}" type="number" value="${p.points}" placeholder="نقاط">
      </div>
      <div class="row2">
        <input data-f="color" data-i="${i}" type="color" value="${p.color}" style="height:38px;">
        <input data-f="weight" data-i="${i}" type="number" value="${p.weight}" placeholder="نسبة الظهور (وزن)">
      </div>`;
    wrap.appendChild(row);
  });
}
$('#saveWheelBtn').onclick = ()=>{
  const prizes = [];
  for(let i=0;i<12;i++){
    prizes.push({
      label: $(`[data-f="label"][data-i="${i}"]`).value,
      points: parseInt($(`[data-f="points"][data-i="${i}"]`).value)||0,
      color: $(`[data-f="color"][data-i="${i}"]`).value,
      weight: parseFloat($(`[data-f="weight"][data-i="${i}"]`).value)||1,
    });
  }
  fx.httpsCallable('adminSetWheelConfig')({prizes}).then(()=> toast('تم حفظ العجلة')).catch(e=>toast(e.message));
};

function loadAdSettings(){
  db.collection('config').doc('adConfig').get().then(s=>{
    const d = s.data() || {pointsPerAd:50, dailyCap:40, minGapSeconds:15};
    $('#adPointsInput').value = d.pointsPerAd;
    $('#adDailyCapInput').value = d.dailyCap;
    $('#adMinGapInput').value = d.minGapSeconds;
  });
}
$('#saveAdSettingsBtn').onclick = ()=>{
  fx.httpsCallable('adminSetAdConfig')({
    pointsPerAd: parseInt($('#adPointsInput').value)||0,
    dailyCap: parseInt($('#adDailyCapInput').value)||0,
    minGapSeconds: parseInt($('#adMinGapInput').value)||10,
  }).then(()=>toast('تم الحفظ')).catch(e=>toast(e.message));
};

function loadCatalogEditor(){
  const wrap = $('#catalogEditor'); wrap.innerHTML='';
  (catalogData.games||[]).forEach((game, gi)=>{
    const g = document.createElement('div'); g.style.border='1px solid rgba(255,255,255,.08)'; g.style.padding='10px'; g.style.borderRadius='10px'; g.style.marginBottom='10px';
    g.innerHTML = `<div class="row2">
        <input data-g="${gi}" data-gf="name" value="${game.name}" placeholder="اسم اللعبة (مثال: جواهر FF)">
        <button class="btn danger" style="flex:none; width:40px;" data-delgame="${gi}">حذف</button>
      </div>
      <div class="row2"><input data-g="${gi}" data-gf="imageUrl" value="${game.imageUrl||''}" placeholder="رابط صورة صغيرة (صندوق الشحن)"></div>
      <div data-items="${gi}"></div>
      <button class="btn ghost" data-additem="${gi}" style="margin-top:6px;">+ إضافة سعر</button>`;
    wrap.appendChild(g);
    const itemsWrap = g.querySelector(`[data-items="${gi}"]`);
    (game.items||[]).forEach((item, ii)=>{
      const row = document.createElement('div'); row.className='row2'; row.style.marginTop='6px';
      row.innerHTML = `<input data-g="${gi}" data-ii="${ii}" data-itf="label" value="${item.label}" placeholder="مثلا: 100 جوهرة">
        <input data-g="${gi}" data-ii="${ii}" data-itf="cost" type="number" value="${item.cost}" placeholder="التكلفة بالنقاط">`;
      itemsWrap.appendChild(row);
    });
  });
  wrap.querySelectorAll('[data-delgame]').forEach(b=> b.onclick = ()=>{ catalogData.games.splice(parseInt(b.dataset.delgame),1); loadCatalogEditor(); });
  wrap.querySelectorAll('[data-additem]').forEach(b=> b.onclick = ()=>{
    const gi = parseInt(b.dataset.additem);
    catalogData.games[gi].items = catalogData.games[gi].items || [];
    catalogData.games[gi].items.push({id:'it_'+Date.now(), label:'', cost:0});
    loadCatalogEditor();
  });
}
$('#addCatalogRowBtn').onclick = ()=>{
  catalogData.games = catalogData.games || [];
  catalogData.games.push({id:'g_'+Date.now(), name:'لعبة جديدة', imageUrl:'', items:[]});
  loadCatalogEditor();
};
function collectCatalogFromDOM(){
  $$('#catalogEditor [data-g]').forEach(inp=>{
    const gi = parseInt(inp.dataset.g);
    if(inp.dataset.gf) catalogData.games[gi][inp.dataset.gf] = inp.value;
    if(inp.dataset.itf) catalogData.games[gi].items[parseInt(inp.dataset.ii)][inp.dataset.itf] = inp.dataset.itf==='cost' ? (parseInt(inp.value)||0) : inp.value;
  });
  return catalogData;
}
// save catalog on tab switch away, plus explicit button
const saveCatalogBtn = document.createElement('button');
saveCatalogBtn.className='btn'; saveCatalogBtn.textContent='حفظ قائمة الاستبدال'; saveCatalogBtn.style.marginTop='10px';
saveCatalogBtn.onclick = ()=>{
  const data = collectCatalogFromDOM();
  fx.httpsCallable('adminSetCatalog')({games:data.games}).then(()=>toast('تم الحفظ')).catch(e=>toast(e.message));
};
$('#ad-catalog .card').appendChild(saveCatalogBtn);

function loadRequests(){
  db.collection('redemptions').where('status','==','pending').orderBy('createdAt').onSnapshot(qs=>{
    const list = $('#requestsList'); list.innerHTML='';
    if(qs.empty){ list.innerHTML='<div style="color:var(--text-dim); font-size:12px;">لا توجد طلبات حاليا</div>'; return; }
    qs.forEach(doc=>{
      const r = doc.data();
      const row = document.createElement('div'); row.className='card'; row.style.marginBottom='8px';
      row.innerHTML = `<div style="font-size:13px;"><b>${r.userName||''}</b> — ${r.itemLabel} (${r.cost} نقطة)</div>
        <div style="font-size:12px; color:var(--text-dim); margin:4px 0;">ID اللعبة: ${r.playerId}</div>
        ${r.note? `<div style="font-size:12px; color:var(--text-dim);">ملاحظة: ${r.note}</div>` : ''}
        <input placeholder="ملاحظة للرد (اختياري)" data-note="${doc.id}">
        <div class="row2" style="margin-top:6px;">
          <button class="btn ok" data-approve="${doc.id}">قبول</button>
          <button class="btn danger" data-reject="${doc.id}">رفض</button>
        </div>`;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-approve]').forEach(b=> b.onclick = ()=>{
      const note = list.querySelector(`[data-note="${b.dataset.approve}"]`).value;
      fx.httpsCallable('approveRedemption')({id:b.dataset.approve, note}).then(()=>toast('تم القبول'));
    });
    list.querySelectorAll('[data-reject]').forEach(b=> b.onclick = ()=>{
      const note = list.querySelector(`[data-note="${b.dataset.reject}"]`).value;
      fx.httpsCallable('rejectRedemption')({id:b.dataset.reject, note}).then(()=>toast('تم الرفض'));
    });
  });
}

function loadTopUsers(){
  db.collection('users').orderBy('points','desc').limit(25).get().then(qs=>{
    const list = $('#usersList'); list.innerHTML='';
    qs.forEach(doc=>{
      const u = doc.data();
      const row = document.createElement('div'); row.className='flag-row';
      row.innerHTML = `<span>${u.name||'—'} (${(u.points||0).toLocaleString('ar')})</span>
        <button class="btn ${u.banned?'ok':'danger'}" data-ban="${doc.id}" data-cur="${!!u.banned}" style="width:auto; padding:4px 10px;">${u.banned?'فك الحظر':'حظر'}</button>`;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-ban]').forEach(b=> b.onclick = ()=>{
      const cur = b.dataset.cur==='true';
      fx.httpsCallable('setUserBan')({uid:b.dataset.ban, banned: !cur}).then(loadTopUsers);
    });
  });
}

function loadAlerts(){
  db.collection('alerts').orderBy('createdAt','desc').limit(30).onSnapshot(qs=>{
    const list = $('#alertsList'); list.innerHTML='';
    if(qs.empty){ list.innerHTML='<div style="color:var(--text-dim); font-size:12px;">لا توجد تنبيهات</div>'; return; }
    qs.forEach(doc=>{
      const a = doc.data();
      const row = document.createElement('div'); row.className='card'; row.style.marginBottom='8px';
      row.innerHTML = `<div style="font-size:13px;"><b>${a.userName||a.uid}</b> — ${a.reason}</div>
        <div style="font-size:12px; color:var(--text-dim);">${a.bannedUntil ? 'محظور حتى: '+new Date(a.bannedUntil.toMillis()).toLocaleString('ar') : ''}</div>
        <div class="row2" style="margin-top:6px;">
          <button class="btn ok" data-unban="${a.uid}">فك الحظر</button>
          <button class="btn danger" data-extend="${a.uid}">تمديد ساعة</button>
        </div>`;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-unban]').forEach(b=> b.onclick = ()=> fx.httpsCallable('setUserBan')({uid:b.dataset.unban, banned:false}));
    list.querySelectorAll('[data-extend]').forEach(b=> b.onclick = ()=> fx.httpsCallable('extendBan')({uid:b.dataset.extend}));
  });
}

function loadToursAdmin(){
  db.collection('tournaments').orderBy('createdAt','desc').onSnapshot(qs=>{
    const list = $('#toursAdminList'); list.innerHTML='';
    qs.forEach(doc=>{
      const t = doc.data();
      const row = document.createElement('div'); row.className='card'; row.style.marginBottom='8px';
      row.innerHTML = `<div style="font-size:13px;"><b>${t.title}</b> — ${t.status}</div>
        <div class="row2" style="margin-top:6px;">
          <button class="btn ghost" data-edit="${doc.id}">تعديل / بدء</button>
          <button class="btn danger" data-del="${doc.id}">حذف</button>
        </div>`;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-edit]').forEach(b=> b.onclick = ()=> openTourEditor(b.dataset.edit));
    list.querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=> fx.httpsCallable('adminDeleteTournament')({id:b.dataset.del}));
  });
}
$('#newTourBtn').onclick = ()=> openTourEditor(null);
function openTourEditor(id){
  const existing = id ? null : null; // fetched inline below if needed
  const run = (t)=>{
    const title = prompt('عنوان البطولة:', t?.title || 'بطولة فري فاير');
    if(title===null) return;
    const imageUrl = prompt('رابط صورة الخلفية:', t?.imageUrl || '') || '';
    const prizeAmount = parseInt(prompt('عدد التوكنات كجائزة:', t?.prizeAmount || 1000)) || 0;
    const days = parseInt(prompt('كم يوم متبقي؟', 0)) || 0;
    const hours = parseInt(prompt('كم ساعة؟', 0)) || 0;
    const mins = parseInt(prompt('كم دقيقة؟', 0)) || 0;
    const roomId = prompt('معرف الغرفة (اتركه فارغا إن لم يبدأ بعد):', t?.roomId || '') || '';
    const endInMs = ((days*24+hours)*60+mins)*60000;
    fx.httpsCallable('adminSaveTournament')({id, title, imageUrl, prizeAmount, endInMs: endInMs>0?endInMs:null, roomId})
      .then(()=>toast('تم الحفظ')).catch(e=>toast(e.message));
  };
  if(id){ db.collection('tournaments').doc(id).get().then(s=> run(s.data())); }
  else run(null);
}

function loadSupportThreads(){
  db.collectionGroup('messages').orderBy('createdAt','desc').limit(100).onSnapshot(qs=>{
    const byUser = {};
    qs.forEach(doc=>{
      const uid = doc.ref.parent.parent.id;
      if(!byUser[uid]) byUser[uid] = doc.data();
    });
    const list = $('#supportThreads'); list.innerHTML='';
    Object.entries(byUser).forEach(([uid, m])=>{
      const row = document.createElement('div'); row.className='flag-row'; row.style.cursor='pointer';
      row.innerHTML = `<span>👤 ${m.userName||uid} — ${m.text?.slice(0,20)||''}</span>
        <button class="btn danger" data-delthread="${uid}" style="width:auto; padding:4px 10px;">حذف</button>`;
      row.onclick = (e)=>{ if(e.target.closest('[data-delthread]')) return; openAdminChat(uid); };
      list.appendChild(row);
    });
    list.querySelectorAll('[data-delthread]').forEach(b=> b.onclick = (e)=>{
      e.stopPropagation();
      fx.httpsCallable('deleteSupportThread')({uid:b.dataset.delthread});
    });
  });
}
function openAdminChat(uid){
  $('#supportModal').classList.add('show');
  $('#chatSendBtn').onclick = ()=>{
    const v = $('#chatInput').value.trim(); if(!v) return;
    fx.httpsCallable('adminReplySupport')({uid, text:v});
    $('#chatInput').value='';
  };
  db.collection('supportChats').doc(uid).collection('messages').orderBy('createdAt').onSnapshot(qs=>{
    const box = $('#chatBox'); box.innerHTML='';
    qs.forEach(doc=>{
      const m = doc.data();
      const div = document.createElement('div');
      div.className = 'msg ' + (m.from==='dev' ? 'me' : 'dev');
      div.textContent = m.text;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  });
}
