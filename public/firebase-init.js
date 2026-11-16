// ضع هنا بيانات مشروعك من Firebase Console > Project settings > General > Your apps > SDK setup
// لا تضع هنا أي صلاحيات إدارية؛ هذا المفتاح مخصص لتطبيقات الواجهة الأمامية (public) وآمن للنشر.
const firebaseConfig = {
  apiKey: "ضع-القيمة-هنا",
  authDomain: "ضع-القيمة-هنا.firebaseapp.com",
  projectId: "ضع-القيمة-هنا",
  storageBucket: "ضع-القيمة-هنا.appspot.com",
  messagingSenderId: "ضع-القيمة-هنا",
  appId: "ضع-القيمة-هنا"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const fx = firebase.functions(); // region افتراضية: us-central1
