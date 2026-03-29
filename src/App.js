import React, { useState, useEffect } from 'react';
import { 
  Clock, LogOut, UserPlus, Users, List, CheckCircle, 
  LogIn, AlertCircle, Calendar, Download, Search, X, Trash2, History, Globe, Edit2, Sun, CalendarDays, ChevronLeft, ChevronRight, FileText, Mail, CheckSquare, XCircle, Send, Settings
} from 'lucide-react';

// ==========================================
// 🔴 Firebase 雲端資料庫設定區
// ==========================================
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';

let firebaseConfig = {
  apiKey: "AIzaSyArHwxxCWehm40c6TSKBxm9A5pcHnjEZbE",
  authDomain: "check-in-ct.firebaseapp.com",
  projectId: "check-in-ct",
  storageBucket: "check-in-ct.firebasestorage.app",
  messagingSenderId: "475043764561",
  appId: "1:475043764561:web:f73138c945094bac435b70",
  measurementId: "G-8SZG6RW43L"
};

if (typeof __firebase_config !== 'undefined' && __firebase_config) {
  try { firebaseConfig = JSON.parse(__firebase_config); } catch (e) { console.warn("讀取測試環境資料庫失敗"); }
}

let app, auth, db;
let isFirebaseInitialized = false;

try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  db = getFirestore(app);
  isFirebaseInitialized = true;
} catch (error) {
  console.error("Firebase 初始化失敗！請檢查設定:", error);
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'punch-system-dev';

// --- 工具函數 ---
// 計算台灣勞基法特休天數
const calculateTaiwanAnnualLeave = (hireDateStr) => {
  if (!hireDateStr) return 0;
  const hireDate = new Date(hireDateStr);
  const today = new Date();
  if (isNaN(hireDate.getTime())) return 0;

  let months = (today.getFullYear() - hireDate.getFullYear()) * 12 + (today.getMonth() - hireDate.getMonth());
  if (today.getDate() < hireDate.getDate()) months--;
  
  const years = months / 12;

  if (years < 0.5) return 0;
  if (years >= 0.5 && years < 1) return 3;
  if (years >= 1 && years < 2) return 7;
  if (years >= 2 && years < 3) return 10;
  if (years >= 3 && years < 5) return 14;
  if (years >= 5 && years < 10) return 15;
  if (years >= 10) return Math.min(15 + Math.floor(years) - 9, 30);
  return 0;
};

// 計算年資字串
const formatTenure = (hireDateStr) => {
  if (!hireDateStr) return '未設定';
  const hireDate = new Date(hireDateStr);
  const today = new Date();
  if (isNaN(hireDate.getTime())) return '無效日期';

  let months = (today.getFullYear() - hireDate.getFullYear()) * 12 + (today.getMonth() - hireDate.getMonth());
  if (today.getDate() < hireDate.getDate()) months--;
  
  if (months < 0) return '尚未到職';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}個月`;
  return m === 0 ? `${y}年` : `${y}年 ${m}個月`;
};

const ipToInt = (ip) => {
  try { return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0; } catch (e) { return 0; }
};

const checkIpAllowed = (clientIp, allowedIPsString) => {
  if (!allowedIPsString || allowedIPsString.trim() === '') return true; 
  const rules = allowedIPsString.split(',').map(r => r.trim()).filter(r => r !== '');
  if (rules.length === 0) return true;

  for (let rule of rules) {
    if (rule === clientIp) return true;
    if (rule.endsWith('*')) {
      const prefix = rule.slice(0, -1);
      if (clientIp.startsWith(prefix)) return true;
    }
    if (rule.includes('-')) {
      const parts = rule.split('-');
      if (parts.length === 2) {
        try {
          const clientInt = ipToInt(clientIp);
          const startInt = ipToInt(parts[0].trim());
          const endInt = ipToInt(parts[1].trim());
          if (clientInt >= startInt && clientInt <= endInt) return true;
        } catch(e) {}
      }
    }
  }
  return false; 
};

// 判斷假日
const checkIsHoliday = (dateObj, holidaysList) => {
  const day = dateObj.getDay();
  if (day === 0 || day === 6) return { isOff: true, name: '週末假日' };
  
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const date = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${date}`;
  
  const customHoliday = holidaysList.find(h => h.date === dateStr);
  if (customHoliday) return { isOff: true, name: customHoliday.name };
  
  return { isOff: false, name: '工作日' };
};

// 分鐘格式化為 X小時 Y分
const formatMins = (mins) => {
  if (mins <= 0) return '0 分';
  if (mins < 60) return `${mins} 分`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} 小時 ${m} 分` : `${h} 小時`;
};

// 取得星期幾字串
const getWeekdayStr = (dateStr) => {
  const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return `(${days[d.getDay()]})`;
};

// ==========================================
// 主程式入口
// ==========================================
export default function App() {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  
  const [users, setUsers] = useState([]);
  const [records, setRecords] = useState([]);
  const [holidays, setHolidays] = useState([]); 
  const [leaves, setLeaves] = useState([]); 
  const [overtimes, setOvertimes] = useState([]); 
  const [systemName, setSystemName] = useState('戰地記憶的燈塔：金門莒光樓');
  const [currentUser, setCurrentUser] = useState(null);
  
  const [toast, setToast] = useState(null);
  const [emailNotification, setEmailNotification] = useState(null); 
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clientIp, setClientIp] = useState('讀取中...'); 
  const [adminView, setAdminView] = useState('records'); 

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isDataLoaded) { setIsDataLoaded(true); setLoadError("載入時間過長，可能是資料庫權限尚未開啟！"); }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isDataLoaded]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (!document.getElementById('tailwind-script')) {
        const script = document.createElement('script'); script.id = 'tailwind-script'; script.src = 'https://cdn.tailwindcss.com'; document.head.appendChild(script);
      }
      if (!document.getElementById('xlsx-style-script')) {
        const script = document.createElement('script'); script.id = 'xlsx-style-script'; script.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js'; document.head.appendChild(script);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    try { fetch('https://api.ipify.org?format=json').then(res => res.json()).then(data => setClientIp(data.ip)).catch(() => setClientIp('192.168.1.100 (模擬IP)')); } catch (e) { setClientIp('192.168.1.100 (模擬IP)'); }
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isFirebaseInitialized) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token);
        else await signInAnonymously(auth);
      } catch (err) { console.error("Firebase登入失敗", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, user => setFirebaseUser(user));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!firebaseUser || !isFirebaseInitialized) return;

    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_users');
    const recordsRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_records');
    const holidaysRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_holidays'); 
    const leavesRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_leaves');
    const overtimesRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_overtimes');
    const settingsRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_settings');

    const unsubUsers = onSnapshot(usersRef, async (snapshot) => {
      if (snapshot.empty) {
        try {
          await setDoc(doc(usersRef, 'admin_init'), { id: 'admin_init', username: 'admin', password: 'password', name: '系統管理員', role: 'admin', allowedIP: '', email: 'arok276@ct.org.tw', annualLeaveTotal: 14, hireDate: '2020-01-01', ignoreLate: false, ignoreIpRestriction: false });
          await setDoc(doc(usersRef, 'employee_init'), { id: 'employee_init', username: 'employee', password: 'password', name: '測試員工小明', role: 'employee', allowedIP: '', email: 'arok276@gmail.com', annualLeaveTotal: 10, hireDate: '2023-05-10', ignoreLate: false, ignoreIpRestriction: false });
        } catch (err) { console.error("寫入預設帳號失敗", err); } finally { setIsDataLoaded(true); }
      } else {
        setUsers(snapshot.docs.map(d => ({ ...d.data(), docId: d.id })));
        setIsDataLoaded(true);
      }
    }, (err) => { setLoadError("資料讀取失敗，請確認權限。"); setIsDataLoaded(true); });

    const unsubRecords = onSnapshot(recordsRef, (snapshot) => {
      const loadedRecords = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }));
      loadedRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setRecords(loadedRecords);
    });

    const unsubHolidays = onSnapshot(holidaysRef, (snapshot) => {
      const loadedHolidays = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }));
      loadedHolidays.sort((a, b) => a.date.localeCompare(b.date));
      setHolidays(loadedHolidays);
    });

    const unsubLeaves = onSnapshot(leavesRef, (snapshot) => {
      const loadedLeaves = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }));
      setLeaves(loadedLeaves);
    });

    const unsubOvertimes = onSnapshot(overtimesRef, (snapshot) => {
      const loadedOvertimes = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }));
      setOvertimes(loadedOvertimes);
    });

    const unsubSettings = onSnapshot(settingsRef, (snapshot) => {
      if (snapshot.empty) {
        setDoc(doc(settingsRef, 'config'), { systemName: '戰地記憶的燈塔：金門莒光樓' }).catch(err => console.log(err));
      } else {
        const configDoc = snapshot.docs.find(d => d.id === 'config');
        if (configDoc && configDoc.data().systemName) setSystemName(configDoc.data().systemName);
      }
    });

    return () => { unsubUsers(); unsubRecords(); unsubHolidays(); unsubLeaves(); unsubOvertimes(); unsubSettings(); };
  }, [firebaseUser]);

  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };
  
  const sendMockEmail = (toEmail, subject, body) => {
    setEmailNotification({ to: toEmail, subject, body });
    setTimeout(() => setEmailNotification(null), 6000); 
  };

  const handleLogin = (username, password, rememberMe) => {
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      if (!user.ignoreIpRestriction && !checkIpAllowed(clientIp, user.allowedIP)) { 
        showToast(`登入失敗！IP不在允許清單中。`, 'error'); return; 
      }
      setCurrentUser(user);
      if (user.role === 'admin') setAdminView('records');
      try { if (rememberMe) localStorage.setItem('punchSystemCredentials', JSON.stringify({ username, password })); else localStorage.removeItem('punchSystemCredentials'); } catch (error) {}
      showToast(`歡迎回來，${user.name}！`, 'success');
    } else { showToast('帳號或密碼錯誤！', 'error'); }
  };

  const handleLogout = () => { setCurrentUser(null); showToast('已成功登出。', 'success'); };

  // --- 員工操作 (打卡/請假/加班) ---
  const handlePunch = async (type) => {
    const todayStr = new Date().toDateString();
    const hasPunchedToday = records.some(r => r.userId === currentUser.id && r.type === type && new Date(r.timestamp).toDateString() === todayStr);
    if (hasPunchedToday) { showToast(`您今天已經打過${type === 'in' ? '上班' : '下班'}卡了！`, 'error'); return; }

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'punch_records'), { id: Date.now().toString(), userId: currentUser.id, userName: currentUser.name, type: type, timestamp: new Date().toISOString() });
      showToast(type === 'in' ? '上班打卡成功！' : '下班打卡成功！', 'success');
    } catch (err) { showToast('網路錯誤，打卡失敗！', 'error'); }
  };

  const handleApplyLeave = async (dateStr, leaveType, leaveHours) => {
    if (leaves.some(l => l.userId === currentUser.id && l.date === dateStr && l.status !== 'rejected')) { 
      showToast('這天已經有請假紀錄或正在審核中了！', 'error'); return; 
    }
    
    const hoursNum = Number(leaveHours) || 8;

    // 年假餘額計算
    if (leaveType === '年假') {
      const usedAnnualHours = leaves.filter(l => l.userId === currentUser.id && l.leaveType === '年假' && l.status !== 'rejected').reduce((sum, l) => sum + (Number(l.hours) || 8), 0);
      const remainingAnnualHours = ((currentUser.annualLeaveTotal || 0) * 8) - usedAnnualHours;
      if (hoursNum > remainingAnnualHours) { showToast(`年假餘額不足！(僅剩 ${remainingAnnualHours / 8} 天)`, 'error'); return; }
    }

    // 補休餘額計算
    if (leaveType === '補休') {
      const earnedComp = overtimes.filter(o => o.userId === currentUser.id && o.status === 'approved').reduce((sum, o) => sum + Number(o.hours), 0);
      const usedComp = leaves.filter(l => l.userId === currentUser.id && l.leaveType === '補休' && l.status !== 'rejected').reduce((sum, l) => sum + (Number(l.hours) || 8), 0);
      const remainComp = earnedComp - usedComp;
      if (hoursNum > remainComp) { showToast(`補休餘額不足！(僅剩 ${remainComp} 小時)`, 'error'); return; }
    }

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'punch_leaves'), { id: Date.now().toString(), userId: currentUser.id, userName: currentUser.name, date: dateStr, leaveType, hours: hoursNum, status: 'pending', timestamp: new Date().toISOString() });
      showToast(`已成功送出 ${leaveType} (${hoursNum}H) 申請`, 'success');
      const adminUser = users.find(u => u.role === 'admin');
      sendMockEmail(adminUser?.email || 'arok276@ct.org.tw', `[請假申請] 員工 ${currentUser.name} 申請 ${leaveType}`, `管理者 您好：\n\n員工 ${currentUser.name} 已提出請假申請。\n\n▶ 日期：${dateStr} ${getWeekdayStr(dateStr)}\n▶ 假別：${leaveType}\n▶ 時數：${hoursNum} 小時\n\n煩請登入系統簽核：\n${window.location.href}`);
    } catch (err) { showToast('請假申請失敗！', 'error'); }
  };

  const handleApplyOvertime = async (dateStr, hours, reason) => {
    if (overtimes.some(o => o.userId === currentUser.id && o.date === dateStr && o.status !== 'rejected')) { 
      showToast('這天已經申請過加班了！', 'error'); return; 
    }
    if (hours > 8) { showToast('單日加班不可超過 8 小時', 'error'); return; }
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'punch_overtimes'), { id: Date.now().toString(), userId: currentUser.id, userName: currentUser.name, date: dateStr, hours: Number(hours), reason, status: 'pending', timestamp: new Date().toISOString() });
      showToast(`已成功送出加班申請`, 'success');
      const adminUser = users.find(u => u.role === 'admin');
      sendMockEmail(adminUser?.email || 'arok276@ct.org.tw', `[加班申請] 員工 ${currentUser.name} 申請加班`, `管理者 您好：\n\n員工 ${currentUser.name} 已提出加班申請。\n\n▶ 日期：${dateStr} ${getWeekdayStr(dateStr)}\n▶ 時數：${hours} 小時\n▶ 事由：${reason}\n\n煩請登入系統簽核：\n${window.location.href}`);
    } catch (err) { showToast('加班申請失敗！', 'error'); }
  };

  const handleDeleteForm = async (docId, type) => {
    try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', type === 'leave' ? 'punch_leaves' : 'punch_overtimes', docId)); showToast('已取消該申請', 'success'); } 
    catch (err) { showToast('取消申請失敗！', 'error'); }
  };

  // --- 管理員簽核操作 ---
  const handleApproveForm = async (docId, isApproved, employeeId, dateStr, formType, formDetail) => {
    try {
      const newStatus = isApproved ? 'approved' : 'rejected';
      const collectionName = formType === 'leave' ? 'punch_leaves' : 'punch_overtimes';
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', collectionName, docId), { status: newStatus });
      showToast(isApproved ? '已批准該表單' : '已駁回該表單', 'success');

      const emp = users.find(u => u.id === employeeId);
      const typeText = formType === 'leave' ? `${formDetail}請假` : `加班 ${formDetail}`;
      sendMockEmail(emp?.email || '未設定信箱', `[審核結果] 您的 ${typeText} 申請已被${isApproved ? '批准' : '駁回'}`, `${emp?.name || '員工'} 您好：\n\n您於 ${dateStr} ${getWeekdayStr(dateStr)} 申請的 ${typeText}，已被管理者 ${isApproved ? '批准 ✅' : '駁回 ❌'}。\n\n請登入系統查看：\n${window.location.href}`);
    } catch (err) { showToast('審核操作失敗', 'error'); }
  };

  // --- 其他管理員操作 ---
  const handleAddUser = async (newUser) => { if (users.some(u => u.username === newUser.username)) { showToast('帳號已存在！', 'error'); return; } try { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'punch_users'), { ...newUser, id: Date.now().toString() }); showToast(`新增成功`, 'success'); setAdminView('users'); } catch (err) { showToast('新增失敗！', 'error'); } };
  const handleEditUser = async (docId, updatedData) => { if (users.some(u => u.username === updatedData.username && u.docId !== docId)) { showToast('帳號已存在！', 'error'); return; } try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_users', docId), updatedData); showToast(`更新成功`, 'success'); if (currentUser.id === updatedData.id) setCurrentUser({ ...currentUser, ...updatedData }); } catch (err) { showToast('更新失敗！', 'error'); } };
  const handleUpdateUserIP = async (docId, newIP) => { try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_users', docId), { allowedIP: newIP }); showToast('更新 IP 成功', 'success'); } catch (err) { showToast('更新 IP 失敗', 'error'); } };
  const handleDeleteUser = async (docId, userId, userName) => { if (userId === currentUser.id) { showToast('無法刪除自己！', 'error'); return; } try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_users', docId)); showToast(`已刪除`, 'success'); } catch (err) { showToast('刪除失敗', 'error'); } };
  const handleEditRecord = async (docId, newTimestamp) => { try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_records', docId), { timestamp: newTimestamp }); showToast('時間更新成功！', 'success'); } catch (err) { showToast('更新失敗！', 'error'); } };
  const handleDeleteRecord = async (docId) => { try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_records', docId)); showToast('已刪除紀錄', 'success'); } catch (err) { showToast('刪除失敗！', 'error'); } };
  const handleAddHoliday = async (date, name) => { if (holidays.some(h => h.date === date)) { showToast('已設定過節日！', 'error'); return; } try { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'punch_holidays'), { date, name, id: Date.now().toString() }); showToast('新增節日成功', 'success'); } catch (err) { showToast('新增失敗', 'error'); } };
  const handleDeleteHoliday = async (docId) => { try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_holidays', docId)); showToast('已移除節日', 'success'); } catch (err) { showToast('刪除失敗', 'error'); } };
  
  // 🚀 自動匯入台灣國定假日 API (支援 404 防呆提示)
  const handleImportTaiwanHolidays = async (year) => {
    try {
      showToast(`正在抓取 ${year} 年人事總處行事曆...`, 'success');
      const res = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`);
      if (!res.ok) {
        if (res.status === 404) throw new Error(`政府尚無 ${year} 年的公告行事曆資料`);
        throw new Error('找不到該年度資料');
      }
      const data = await res.json();
      
      const newHolidays = [];
      data.forEach(h => {
        if (h.isHoliday) {
          const dateStr = `${h.date.substring(0,4)}-${h.date.substring(4,6)}-${h.date.substring(6,8)}`;
          // 抓取真實的假日名稱，若無則使用 description
          const holidayName = h.name || h.description || '國定假日';
          
          if (holidayName.trim() !== '' && !holidays.some(exist => exist.date === dateStr) && !newHolidays.some(newH => newH.date === dateStr)) {
             newHolidays.push({ 
               date: dateStr, 
               name: holidayName, 
               id: Date.now().toString() + Math.random().toString(36).substr(2, 5) 
             });
          }
        }
      });

      if (newHolidays.length === 0) {
         showToast(`${year} 年的假日已全在系統中或無休假資料！`, 'success');
         return;
      }

      const holidaysRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_holidays');
      await Promise.all(newHolidays.map(h => addDoc(holidaysRef, h)));
      
      showToast(`成功匯入 ${newHolidays.length} 筆國定假日！`, 'success');
    } catch (err) {
      showToast(err.message || '自動匯入失敗，請確認網路連線', 'error');
    }
  };

  const handleUpdateSystemName = async (newName) => { try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_settings', 'config'), { systemName: newName }, { merge: true }); showToast('系統名稱更新成功！', 'success'); } catch (err) { showToast('更新系統名稱失敗', 'error'); } };

  if (!isFirebaseInitialized) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><AlertCircle className="w-16 h-16 text-red-500 animate-pulse" /></div>;
  if (!isDataLoaded) return <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center"><Clock className="w-12 h-12 text-blue-600 animate-bounce mb-4" /><p className="text-gray-500">載入中...</p></div>;
  if (!currentUser) return <>{loadError && <div className="bg-red-50 text-red-600 p-3 text-center text-sm font-bold absolute w-full top-0 z-50">{loadError}</div>}<LoginScreen onLogin={handleLogin} toast={toast} clientIp={clientIp} systemName={systemName} /></>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans relative overflow-hidden">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-blue-600 flex-shrink-0"><Clock className="w-6 h-6 sm:w-7 sm:h-7" /><h1 className="font-bold text-lg sm:text-xl tracking-wide truncate hidden xs:block">{systemName}</h1></div>
          <div className="flex items-center space-x-3 sm:space-x-4"><div className="text-right flex flex-col items-end"><span className="font-bold text-gray-900 text-sm sm:text-base">{currentUser.name}</span><span className="text-[10px] sm:text-xs bg-gray-100 px-2 py-0.5 rounded-full mt-0.5 text-gray-600 font-medium">{currentUser.role === 'admin' ? '管理員' : '一般員工'}</span></div><button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors flex-shrink-0"><LogOut className="w-5 h-5 sm:w-6 sm:h-6" /></button></div>
        </div>
      </header>

      {toast && (
        <div className="fixed top-20 left-4 right-4 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 z-50 animate-fade-in-down flex justify-center">
          <div className={`flex items-center w-full sm:w-auto px-4 sm:px-5 py-3 rounded-lg shadow-xl ${toast.type === 'success' ? 'bg-green-50 border-l-4 border-green-500 text-green-800' : 'bg-red-50 border-l-4 border-red-500 text-red-800'}`}><CheckCircle className="w-5 h-5 mr-2" /><p className="font-medium text-sm sm:text-base">{toast.message}</p></div>
        </div>
      )}

      {emailNotification && (
        <div className="fixed top-24 right-4 z-50 w-80 bg-white rounded-xl shadow-2xl border border-blue-100 overflow-hidden animate-slide-in-right">
          <div className="bg-blue-600 px-4 py-2.5 flex items-center justify-between"><div className="flex items-center text-white font-bold text-sm"><Send className="w-4 h-4 mr-2 animate-pulse" /> 系統已發送 Email 通知</div><button onClick={() => setEmailNotification(null)} className="text-blue-200 hover:text-white"><X className="w-4 h-4" /></button></div>
          <div className="p-4 text-sm bg-blue-50/30"><p className="text-gray-500 mb-1">收件人：<span className="text-blue-600 font-medium">{emailNotification.to}</span></p><p className="text-gray-500 mb-3">主旨：<span className="font-bold text-gray-800">{emailNotification.subject}</span></p><div className="bg-white p-3 rounded border border-gray-200 text-gray-600 whitespace-pre-line h-32 overflow-y-auto text-xs shadow-inner">{emailNotification.body}</div></div>
        </div>
      )}

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {currentUser.role === 'admin' ? (
          <AdminDashboard 
            records={records} users={users} holidays={holidays} leaves={leaves} overtimes={overtimes} systemName={systemName}
            onAddUser={handleAddUser} onEditUser={handleEditUser} onDeleteUser={handleDeleteUser} onUpdateUserIP={handleUpdateUserIP} 
            onEditRecord={handleEditRecord} onDeleteRecord={handleDeleteRecord} onAddHoliday={handleAddHoliday} onDeleteHoliday={handleDeleteHoliday} 
            onApproveForm={handleApproveForm} onDeleteForm={handleDeleteForm} onUpdateSystemName={handleUpdateSystemName} 
            onImportTaiwanHolidays={handleImportTaiwanHolidays} view={adminView} setView={setAdminView} 
            currentTime={currentTime} currentUser={currentUser} clientIp={clientIp} showToast={showToast} 
          />
        ) : (
          <EmployeeDashboard 
            currentTime={currentTime} currentUser={currentUser} clientIp={clientIp}
            records={records.filter(r => r.userId === currentUser.id)} leaves={leaves.filter(l => l.userId === currentUser.id)} overtimes={overtimes.filter(o => o.userId === currentUser.id)}
            holidays={holidays} onPunch={handlePunch} onApplyLeave={handleApplyLeave} onApplyOvertime={handleApplyOvertime} onDeleteForm={handleDeleteForm}
          />
        )}
      </main>
    </div>
  );
}

// ==========================================
// 登入畫面
// ==========================================
function LoginScreen({ onLogin, toast, clientIp, systemName = '戰地記憶的燈塔：金門莒光樓' }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [rememberMe, setRememberMe] = useState(false);
  useEffect(() => { try { const saved = localStorage.getItem('punchSystemCredentials'); if (saved) { const { username, password } = JSON.parse(saved); setUsername(username); setPassword(password); setRememberMe(true); } } catch (e) {} }, []);
  const handleSubmit = (e) => { e.preventDefault(); if (!username || !password) return; onLogin(username, password, rememberMe); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-200 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden mt-6">
        <div className="bg-blue-600 p-6 sm:p-8 text-center relative overflow-hidden"><div className="absolute top-0 left-0 w-full h-full bg-blue-500 opacity-20 transform -skew-y-6 origin-top-left z-0"></div><Clock className="w-12 h-12 sm:w-14 sm:h-14 text-white mx-auto mb-3 relative z-10 drop-shadow-md" /><h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wider relative z-10">{systemName}</h2></div>
        <div className="p-6 sm:p-8">
          {toast && <div className={`mb-6 p-3 sm:p-4 rounded-lg flex items-center text-sm ${toast.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}><AlertCircle className="w-5 h-5 mr-2" /> {toast.message}</div>}
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
            <div><label className="block text-sm font-bold text-gray-700 mb-1.5">帳號</label><div className="relative"><Users className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" /><input type="text" className="w-full pl-10 pr-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="輸入登入帳號" value={username} onChange={(e) => setUsername(e.target.value)} /></div></div>
            <div><label className="block text-sm font-bold text-gray-700 mb-1.5">密碼</label><div className="relative"><LogIn className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" /><input type="password" className="w-full pl-10 pr-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="輸入密碼" value={password} onChange={(e) => setPassword(e.target.value)} /></div></div>
            <div className="flex items-center"><input id="remember-me" type="checkbox" className="h-4 w-4 text-blue-600 rounded cursor-pointer" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /><label htmlFor="remember-me" className="ml-2 text-sm text-gray-700 cursor-pointer">記住帳號與密碼</label></div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md active:scale-95 text-lg">登入系統</button>
          </form>
          <div className="mt-6 flex justify-center items-center text-xs text-gray-400 bg-gray-50 py-2 px-2 rounded-lg border"><Globe className="w-3.5 h-3.5 mr-1.5" />目前網路 IP：<span className="font-mono text-gray-600 ml-1">{clientIp}</span></div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 員工介面
// ==========================================
function EmployeeDashboard({ currentTime, currentUser, records, leaves, overtimes, holidays, onPunch, onApplyLeave, onApplyOvertime, onDeleteForm, clientIp }) {
  const [activeTab, setActiveTab] = useState('today');
  const formatTime = (date) => date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  
  const todayStr = new Date().toDateString();
  const todayRecords = records.filter(r => new Date(r.timestamp).toDateString() === todayStr);
  const hasPunchedInToday = todayRecords.some(r => r.type === 'in');
  const hasPunchedOutToday = todayRecords.some(r => r.type === 'out');
  const todayHolidayInfo = checkIsHoliday(currentTime, holidays);

  const getTodayString = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [leaveDate, setLeaveDate] = useState(getTodayString());
  const [leaveType, setLeaveType] = useState('年假');
  const [leaveHours, setLeaveHours] = useState(8);
  
  const [overtimeDate, setOvertimeDate] = useState(getTodayString());
  const [overtimeHours, setOvertimeHours] = useState(1);
  const [overtimeReason, setOvertimeReason] = useState('');

  // 結算變數
  const usedAnnualHours = leaves.filter(l => l.leaveType === '年假' && l.status !== 'rejected').reduce((sum, l) => sum + (Number(l.hours) || 8), 0);
  const usedAnnualDays = usedAnnualHours / 8;
  const totalAnnual = currentUser.annualLeaveTotal || 0;
  const remainingAnnual = totalAnnual - usedAnnualDays;

  const earnedComp = overtimes.filter(o => o.status === 'approved').reduce((sum, o) => sum + Number(o.hours), 0);
  const usedComp = leaves.filter(l => l.leaveType === '補休' && l.status !== 'rejected').reduce((sum, l) => sum + (Number(l.hours) || 8), 0);
  const remainComp = earnedComp - usedComp;

  const combinedForms = [...leaves.map(l=>({...l, category:'leave'})), ...overtimes.map(o=>({...o, category:'overtime'}))].sort((a,b)=>b.date.localeCompare(a.date));

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-x-auto flex flex-nowrap border-b hide-scrollbar">
        <button onClick={() => setActiveTab('today')} className={`flex-1 min-w-[100px] py-3 font-bold text-sm text-center transition-colors ${activeTab === 'today' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'}`}><Clock className="w-4 h-4 inline-block mr-1 -mt-0.5" />今日紀錄</button>
        <button onClick={() => setActiveTab('history')} className={`flex-1 min-w-[100px] py-3 font-bold text-sm text-center transition-colors ${activeTab === 'history' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'}`}><History className="w-4 h-4 inline-block mr-1 -mt-0.5" />歷史紀錄</button>
        <button onClick={() => setActiveTab('forms')} className={`flex-1 min-w-[100px] py-3 font-bold text-sm text-center transition-colors ${activeTab === 'forms' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'}`}><FileText className="w-4 h-4 inline-block mr-1 -mt-0.5" />表單申請</button>
        <button onClick={() => setActiveTab('holidays')} className={`flex-1 min-w-[100px] py-3 font-bold text-sm text-center transition-colors ${activeTab === 'holidays' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'}`}><CalendarDays className="w-4 h-4 inline-block mr-1 -mt-0.5" />節日日曆</button>
      </div>

      {activeTab === 'today' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-12 text-center relative overflow-hidden animate-fade-in">
          <div className="sm:absolute sm:top-4 sm:left-4 inline-flex items-center text-[10px] sm:text-xs text-gray-500 bg-gray-50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-gray-200 mb-4 sm:mb-0">
            <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />IP: <span className="font-mono ml-1 text-gray-700">{clientIp}</span>
          </div>
          {todayHolidayInfo.isOff && (
            <div className="inline-block mt-2 mb-2 px-4 py-1.5 bg-amber-100 text-amber-800 rounded-full font-bold text-sm shadow-sm border border-amber-200 animate-pulse">
              <Sun className="w-4 h-4 inline-block mr-1.5 -mt-0.5" /> 今日為 {todayHolidayInfo.name}，出勤將自動計為加班
            </div>
          )}
          <h2 className="text-lg sm:text-xl text-gray-500 mb-2 sm:mb-3 mt-2 sm:mt-4">{getTodayString().replace(/-/g, '/')} {getWeekdayStr(getTodayString())}</h2>
          <div className="text-5xl sm:text-7xl font-mono font-bold text-gray-800 tracking-tight mb-8 sm:mb-10">{formatTime(currentTime)}</div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 w-full">
            <button onClick={() => onPunch('in')} disabled={hasPunchedInToday} className={`w-full sm:w-48 px-6 py-3.5 sm:py-4 rounded-xl font-bold text-lg sm:text-xl flex items-center justify-center ${hasPunchedInToday ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg active:scale-95'}`}><Clock className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />{hasPunchedInToday ? '已上班' : '上班打卡'}</button>
            <button onClick={() => onPunch('out')} disabled={hasPunchedOutToday} className={`w-full sm:w-48 px-6 py-3.5 sm:py-4 rounded-xl font-bold text-lg sm:text-xl flex items-center justify-center ${hasPunchedOutToday ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg active:scale-95'}`}><LogOut className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />{hasPunchedOutToday ? '已下班' : '下班打卡'}</button>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden animate-fade-in">
          {records.length === 0 ? <div className="text-center py-16 text-gray-500"><History className="w-12 h-12 mx-auto text-gray-300 mb-3" /><p>尚無任何紀錄</p></div> : (
            <div className="max-h-[500px] overflow-y-auto">
              <ul className="divide-y divide-gray-100">
                {records.map(record => {
                  const d = new Date(record.timestamp);
                  const isHoliday = checkIsHoliday(d, holidays).isOff;
                  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                  return (
                    <li key={record.docId} className="px-5 py-4 flex justify-between hover:bg-gray-50">
                      <div className="flex items-center">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold mr-3 ${record.type === 'in' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>{record.type === 'in' ? '上班' : '下班'}</span>
                        <span className="text-gray-800 font-medium">{dateStr.replace(/-/g,'/')} {getWeekdayStr(dateStr)}</span>
                        {isHoliday && <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">假日出勤</span>}
                      </div>
                      <span className="text-gray-500 font-mono">{d.toLocaleTimeString('zh-TW')}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {activeTab === 'forms' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div className="bg-blue-600 text-white rounded-xl p-4 shadow-md relative overflow-hidden">
                 <h3 className="text-blue-100 text-xs font-bold mb-1 relative z-10">年假餘額</h3>
                 <div className="text-2xl font-bold font-mono relative z-10">{remainingAnnual} <span className="text-xs font-normal">天</span></div>
                 <p className="text-[10px] text-blue-200 mt-1 relative z-10">配額 {totalAnnual} / 已用 {usedAnnualDays}</p>
              </div>
              <div className="bg-purple-600 text-white rounded-xl p-4 shadow-md relative overflow-hidden">
                 <h3 className="text-purple-100 text-xs font-bold mb-1 relative z-10">加班補休餘額</h3>
                 <div className="text-2xl font-bold font-mono relative z-10">{remainComp} <span className="text-xs font-normal">小時</span></div>
                 <p className="text-[10px] text-purple-200 mt-1 relative z-10">總加班 {earnedComp}H / 已休 {usedComp}H</p>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
               <h3 className="font-bold text-gray-800 mb-4 flex items-center"><FileText className="w-4 h-4 mr-2 text-blue-600" />新增請假</h3>
               <form onSubmit={(e)=>{e.preventDefault(); onApplyLeave(leaveDate, leaveType, leaveHours);}} className="space-y-3">
                 <div className="flex gap-2">
                   <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1">日期</label><input type="date" required value={leaveDate} onChange={e => setLeaveDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white" /></div>
                   <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1">假別</label><select value={leaveType} onChange={e => setLeaveType(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"><option value="年假">年假 (特休)</option><option value="補休">補休 (使用加班時數)</option><option value="事假">事假</option><option value="病假">病假</option></select></div>
                   <div className="flex-[0.6]"><label className="block text-xs font-bold text-gray-700 mb-1">時數</label><input type="number" min="0.5" max="8" step="0.5" required value={leaveHours} onChange={e => setLeaveHours(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white font-mono" /></div>
                 </div>
                 {leaveType === '補休' && <p className="text-xs font-bold text-purple-600 mt-1 bg-purple-50 p-2 rounded border border-purple-100">💡 提示：目前可用的加班時數為 {remainComp} 小時</p>}
                 <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg flex justify-center text-sm shadow-sm transition-all mt-2">送出請假單</button>
               </form>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
               <h3 className="font-bold text-gray-800 mb-4 flex items-center"><Clock className="w-4 h-4 mr-2 text-amber-600" />加班申請 (上限 8H)</h3>
               <form onSubmit={(e)=>{e.preventDefault(); onApplyOvertime(overtimeDate, overtimeHours, overtimeReason);}} className="space-y-3">
                 <div className="flex gap-2">
                   <div className="flex-[1.5]"><label className="block text-xs font-bold text-gray-700 mb-1">日期</label><input type="date" required value={overtimeDate} onChange={e => setOvertimeDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 bg-white" /></div>
                   <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1">時數</label><input type="number" required min="0.5" max="8" step="0.5" value={overtimeHours} onChange={e => setOvertimeHours(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 bg-white font-mono" /></div>
                 </div>
                 <div><label className="block text-xs font-bold text-gray-700 mb-1">加班事由</label><input type="text" required value={overtimeReason} onChange={e => setOvertimeReason(e.target.value)} placeholder="填寫工作內容" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 bg-white" /></div>
                 <button type="submit" className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 rounded-lg flex justify-center text-sm shadow-sm transition-all">送出加班單</button>
               </form>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden h-full flex flex-col">
             <div className="p-4 border-b border-gray-100 bg-gray-50/50"><h3 className="font-bold text-gray-800">表單送出紀錄</h3></div>
             <div className="overflow-y-auto flex-1 p-0">
               {combinedForms.length === 0 ? <div className="text-center py-16 text-gray-400"><FileText className="w-10 h-10 mx-auto text-gray-200 mb-2" /><p className="text-sm">尚無申請紀錄</p></div> : (
                  <ul className="divide-y divide-gray-100">
                    {combinedForms.map(f => (
                      <li key={f.docId} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                        <div>
                          <div className="font-bold text-gray-800">{f.date.replace(/-/g, '/')} <span className="font-normal text-sm text-gray-600">{getWeekdayStr(f.date)}</span></div>
                          <div className="text-[10px] text-gray-500 mt-1">申請: {new Date(f.timestamp).toLocaleString('zh-TW')}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${f.category==='leave'?'bg-purple-100 text-purple-700':'bg-amber-100 text-amber-700'}`}>
                             {f.category==='leave' ? `請假 (${f.leaveType}) ${f.hours || 8}H` : `加班 ${f.hours}H`}
                          </span>
                          <div className="flex items-center gap-2">
                             <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${f.status === 'approved' ? 'bg-green-50 text-green-600' : f.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-yellow-50 text-yellow-600'}`}>
                                {f.status === 'approved' ? '已批准' : f.status === 'rejected' ? '已駁回' : '審核中'}
                             </span>
                             {f.status === 'pending' && <button onClick={() => onDeleteForm(f.docId, f.category)} className="text-gray-400 hover:text-red-500" title="取消申請"><XCircle className="w-3.5 h-3.5" /></button>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
               )}
             </div>
          </div>
        </div>
      )}

      {activeTab === 'holidays' && <AdminHolidaysView holidays={holidays} readOnly={true} />}
    </div>
  );
}

// ==========================================
// 管理員介面
// ==========================================
function AdminDashboard({ records, users, holidays, leaves, overtimes, systemName, onAddUser, onEditUser, onDeleteUser, onUpdateUserIP, onEditRecord, onDeleteRecord, onAddHoliday, onDeleteHoliday, onApproveForm, onDeleteForm, onUpdateSystemName, onImportTaiwanHolidays, view, setView, currentTime, currentUser, clientIp, showToast }) {
  const pendingLeavesCount = leaves.filter(l => l.status === 'pending').length;
  const pendingOvertimesCount = overtimes.filter(o => o.status === 'pending').length;
  const totalPending = pendingLeavesCount + pendingOvertimesCount;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex overflow-x-auto border-b border-gray-200 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar">
        <div className="flex space-x-1 sm:space-x-2 min-w-max pb-0.5">
          <button onClick={() => setView('records')} className={`flex items-center px-4 py-3 font-bold text-sm rounded-t-xl transition-all ${view === 'records' ? 'bg-white text-blue-600 border-t border-l border-r border-gray-200 relative -mb-[1px]' : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'}`}><List className="w-4 h-4 mr-1.5" />全體紀錄</button>
          <button onClick={() => setView('users')} className={`flex items-center px-4 py-3 font-bold text-sm rounded-t-xl transition-all ${view === 'users' ? 'bg-white text-blue-600 border-t border-l border-r border-gray-200 relative -mb-[1px]' : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'}`}><Users className="w-4 h-4 mr-1.5" />員工管理</button>
          <button onClick={() => setView('holidays')} className={`flex items-center px-4 py-3 font-bold text-sm rounded-t-xl transition-all ${view === 'holidays' ? 'bg-white text-amber-600 border-t border-l border-r border-gray-200 relative -mb-[1px]' : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'}`}><CalendarDays className="w-4 h-4 mr-1.5" />紀念日及節日</button>
          <button onClick={() => setView('approvals')} className={`flex items-center px-4 py-3 font-bold text-sm rounded-t-xl transition-all ${view === 'approvals' ? 'bg-white text-purple-600 border-t border-l border-r border-gray-200 relative -mb-[1px]' : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'}`}>
            <Mail className="w-4 h-4 mr-1.5" />表單審核
            {totalPending > 0 && <span className="ml-1.5 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{totalPending}</span>}
          </button>
          <button onClick={() => setView('settings')} className={`flex items-center px-4 py-3 font-bold text-sm rounded-t-xl transition-all ${view === 'settings' ? 'bg-white text-gray-800 border-t border-l border-r border-gray-200 relative -mb-[1px]' : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'}`}>
            <Settings className="w-4 h-4 mr-1.5" />系統設定
          </button>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 overflow-hidden">
        {view === 'records' && <AdminRecordsView records={records} leaves={leaves} overtimes={overtimes} users={users} holidays={holidays} showToast={showToast} onEditRecord={onEditRecord} onDeleteRecord={onDeleteRecord} onDeleteForm={onDeleteForm} />}
        {view === 'users' && <AdminUsersView users={users} leaves={leaves} overtimes={overtimes} onAddUser={onAddUser} onEditUser={onEditUser} onDeleteUser={onDeleteUser} onUpdateUserIP={onUpdateUserIP} currentUser={currentUser} />}
        {view === 'holidays' && <AdminHolidaysView holidays={holidays} onAddHoliday={onAddHoliday} onDeleteHoliday={onDeleteHoliday} onImportTaiwanHolidays={onImportTaiwanHolidays} readOnly={false} />}
        {view === 'approvals' && <AdminApprovalsView leaves={leaves} overtimes={overtimes} onApproveForm={onApproveForm} />}
        {view === 'settings' && <AdminSettingsView systemName={systemName} onUpdateSystemName={onUpdateSystemName} />}
      </div>
    </div>
  );
}

// --- 系統設定介面 ---
function AdminSettingsView({ systemName, onUpdateSystemName }) {
  const [tempName, setTempName] = useState(systemName);
  
  useEffect(() => {
    setTempName(systemName);
  }, [systemName]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (tempName.trim()) onUpdateSystemName(tempName.trim());
  };

  return (
    <div className="animate-fade-in w-full max-w-lg">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center"><Settings className="w-6 h-6 mr-2 text-gray-700" />系統一般設定</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">企業/系統名稱顯示</label>
            <input 
              type="text" 
              required 
              value={tempName} 
              onChange={e => setTempName(e.target.value)} 
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" 
              placeholder="例如：王氏企業差勤系統"
            />
            <p className="text-xs text-gray-500 mt-2">此名稱將同步顯示於員工登入畫面及系統左上角標題。</p>
          </div>
          <div className="pt-2 border-t border-gray-100 flex justify-end">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg text-sm shadow-sm transition-all">儲存變更</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- 表單審核介面 ---
function AdminApprovalsView({ leaves, overtimes, onApproveForm }) {
  const pendingLeaves = leaves.filter(l => l.status === 'pending').sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
  const pendingOvertimes = overtimes.filter(o => o.status === 'pending').sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));

  return (
    <div className="animate-fade-in w-full space-y-8">
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><FileText className="w-5 h-5 mr-2 text-purple-600" />待審核請假單 ({pendingLeaves.length})</h2>
        {pendingLeaves.length === 0 ? ( <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-xl border border-dashed"><CheckSquare className="w-8 h-8 mx-auto text-green-300 mb-2" /><p className="text-sm">無待審核請假</p></div> ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {pendingLeaves.map(l => (
                <div key={l.docId} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                   <div className="flex justify-between items-start mb-3">
                      <div><h3 className="font-bold text-gray-900 text-base">{l.userName}</h3><p className="text-[10px] text-gray-500">申請: {new Date(l.timestamp).toLocaleString('zh-TW')}</p></div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${l.leaveType==='年假'?'bg-purple-100 text-purple-700':l.leaveType==='補休'?'bg-indigo-100 text-indigo-700':'bg-pink-100 text-pink-700'}`}>{l.leaveType} {l.hours || 8}H</span>
                   </div>
                   <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 mb-4 text-sm font-bold text-gray-700">
                      日期：<span className="text-blue-600">{l.date.replace(/-/g, '/')} {getWeekdayStr(l.date)}</span>
                   </div>
                   <div className="flex gap-2">
                      <button onClick={() => onApproveForm(l.docId, true, l.userId, l.date, 'leave', `${l.leaveType} ${l.hours||8}H`)} className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-1.5 rounded flex justify-center items-center text-xs shadow-sm"><CheckSquare className="w-3.5 h-3.5 mr-1"/>批准</button>
                      <button onClick={() => onApproveForm(l.docId, false, l.userId, l.date, 'leave', `${l.leaveType} ${l.hours||8}H`)} className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold py-1.5 rounded flex justify-center items-center text-xs border border-red-200"><XCircle className="w-3.5 h-3.5 mr-1"/>駁回</button>
                   </div>
                </div>
             ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><Clock className="w-5 h-5 mr-2 text-amber-600" />待審核加班單 ({pendingOvertimes.length})</h2>
        {pendingOvertimes.length === 0 ? ( <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-xl border border-dashed"><CheckSquare className="w-8 h-8 mx-auto text-green-300 mb-2" /><p className="text-sm">無待審核加班</p></div> ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {pendingOvertimes.map(o => (
                <div key={o.docId} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                   <div className="flex justify-between items-start mb-3">
                      <div><h3 className="font-bold text-gray-900 text-base">{o.userName}</h3><p className="text-[10px] text-gray-500">申請: {new Date(o.timestamp).toLocaleString('zh-TW')}</p></div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">加班 {o.hours}H</span>
                   </div>
                   <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 mb-4 text-xs text-gray-700 space-y-1">
                      <p className="font-bold">日期：<span className="text-blue-600">{o.date.replace(/-/g, '/')} {getWeekdayStr(o.date)}</span></p>
                      <p>事由：<span className="text-gray-600">{o.reason}</span></p>
                   </div>
                   <div className="flex gap-2">
                      <button onClick={() => onApproveForm(o.docId, true, o.userId, o.date, 'overtime', String(o.hours))} className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-1.5 rounded flex justify-center items-center text-xs shadow-sm"><CheckSquare className="w-3.5 h-3.5 mr-1"/>批准</button>
                      <button onClick={() => onApproveForm(o.docId, false, o.userId, o.date, 'overtime', String(o.hours))} className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold py-1.5 rounded flex justify-center items-center text-xs border border-red-200"><XCircle className="w-3.5 h-3.5 mr-1"/>駁回</button>
                   </div>
                </div>
             ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- 紀錄列表與匯出 (整合所有狀態，美化 Excel) ---
function AdminRecordsView({ records, leaves, overtimes, users, holidays, showToast, onEditRecord, onDeleteRecord, onDeleteForm }) {
  const getTodayString = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [startDate, setStartDate] = useState(getTodayString());
  const [endDate, setEndDate] = useState(getTodayString());
  const [filterUserId, setFilterUserId] = useState('');
  const [filterType, setFilterType] = useState('');
  
  const [editingRecord, setEditingRecord] = useState(null);
  const [editDateTime, setEditDateTime] = useState('');
  const [recordToDelete, setRecordToDelete] = useState(null);

  const combinedEvents = [
    ...records.map(r => ({ ...r, eventCategory: 'punch' })),
    ...leaves.filter(l => l.status === 'approved').map(l => ({ ...l, eventCategory: 'leave', timestamp: `${l.date}T00:00:00.000Z` })),
    ...overtimes.filter(o => o.status === 'approved').map(o => ({ ...o, eventCategory: 'overtime', timestamp: `${o.date}T00:00:00.000Z` }))
  ];
  combinedEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const filteredEvents = combinedEvents.filter(event => {
    let matchDate = true, matchUser = true, matchType = true;
    let eventDateStr = event.eventCategory === 'punch' 
      ? `${new Date(event.timestamp).getFullYear()}-${String(new Date(event.timestamp).getMonth() + 1).padStart(2, '0')}-${String(new Date(event.timestamp).getDate()).padStart(2, '0')}`
      : event.date;

    if (startDate && endDate) matchDate = eventDateStr >= startDate && eventDateStr <= endDate;
    else if (startDate) matchDate = eventDateStr >= startDate;
    else if (endDate) matchDate = eventDateStr <= endDate;
    if (filterUserId) matchUser = event.userId === filterUserId;
    
    if (filterType) {
      if (filterType === 'punch_in') matchType = event.eventCategory === 'punch' && event.type === 'in';
      else if (filterType === 'punch_out') matchType = event.eventCategory === 'punch' && event.type === 'out';
      else if (filterType === 'leave_annual') matchType = event.eventCategory === 'leave' && event.leaveType === '年假';
      else if (filterType === 'leave_comp') matchType = event.eventCategory === 'leave' && event.leaveType === '補休';
      else if (filterType === 'leave_personal') matchType = event.eventCategory === 'leave' && event.leaveType === '事假';
      else if (filterType === 'leave_sick') matchType = event.eventCategory === 'leave' && event.leaveType === '病假';
      else if (filterType === 'overtime') matchType = event.eventCategory === 'overtime';
    }

    return matchDate && matchUser && matchType;
  });

  const getRecordStatusUI = (record) => {
    if (record.eventCategory === 'leave') return { isAnomaly: false, text: `請假 (${record.leaveType})`, type: 'leave' };
    if (record.eventCategory === 'overtime') return { isAnomaly: false, text: `核准加班 ${record.hours}H`, type: 'overtime' };

    const d = new Date(record.timestamp);
    const holidayInfo = checkIsHoliday(d, holidays);
    if (holidayInfo.isOff) return { isAnomaly: true, text: `假日打卡 (${holidayInfo.name})`, type: 'holiday' };

    const userObj = users.find(u => u.id === record.userId);
    const isIgnoreLate = userObj?.ignoreLate || false;

    if (record.type === 'in') {
      const limit = new Date(d); limit.setHours(8, 30, 0, 0); 
      if (d > limit && !isIgnoreLate) return { isAnomaly: true, text: `遲到 ${formatMins(Math.floor((d - limit) / 60000))}`, type: 'late' };
    } else {
      const limit = new Date(d); limit.setHours(17, 30, 0, 0); 
      if (d < limit) return { isAnomaly: true, text: `早退 ${formatMins(Math.floor((limit - d) / 60000))}`, type: 'early' };
    }
    return { isAnomaly: false, text: '正常', type: 'normal' };
  };

  // 🚀 Excel 專業美化匯出
  const handleExportExcel = () => {
    if (filteredEvents.length === 0) return;
    if (!window.XLSX) { showToast('Excel 套件載入中，請稍候再試！', 'error'); return; }

    try {
      const wb = window.XLSX.utils.book_new();
      const recordsByMonth = {};
      
      filteredEvents.forEach(e => {
        let monthStr = e.eventCategory === 'punch' 
           ? `${new Date(e.timestamp).getFullYear()}年${String(new Date(e.timestamp).getMonth() + 1).padStart(2, '0')}月`
           : `${e.date.split('-')[0]}年${e.date.split('-')[1]}月`;
        if (!recordsByMonth[monthStr]) recordsByMonth[monthStr] = [];
        recordsByMonth[monthStr].push(e);
      });

      Object.keys(recordsByMonth).sort().forEach(monthStr => {
        const monthEvents = recordsByMonth[monthStr];
        const userDateMap = {};
        
        monthEvents.forEach(e => {
          if (!userDateMap[e.userName]) userDateMap[e.userName] = {};
          let dateStr = e.eventCategory === 'punch' 
             ? `${new Date(e.timestamp).getFullYear()}/${String(new Date(e.timestamp).getMonth() + 1).padStart(2, '0')}/${String(new Date(e.timestamp).getDate()).padStart(2, '0')}`
             : `${e.date.split('-')[0]}/${e.date.split('-')[1]}/${e.date.split('-')[2]}`;
             
          if (!userDateMap[e.userName][dateStr]) userDateMap[e.userName][dateStr] = { in: null, out: null, leave: null, leaveHours: 0, overtimeHours: 0, userId: e.userId };
          
          if (e.eventCategory === 'leave') {
            userDateMap[e.userName][dateStr].leave = e.leaveType;
            userDateMap[e.userName][dateStr].leaveHours = Number(e.hours) || 8;
          }
          else if (e.eventCategory === 'overtime') userDateMap[e.userName][dateStr].overtimeHours += Number(e.hours);
          else if (e.type === 'in') { if (!userDateMap[e.userName][dateStr].in || new Date(e.timestamp) < new Date(userDateMap[e.userName][dateStr].in.timestamp)) userDateMap[e.userName][dateStr].in = e; }
          else { if (!userDateMap[e.userName][dateStr].out || new Date(e.timestamp) > new Date(userDateMap[e.userName][dateStr].out.timestamp)) userDateMap[e.userName][dateStr].out = e; }
        });

        const rows = [];
        rows.push(['員工姓名', '日期', '星期', '上班時間', '下班時間', '遲到時間', '早退時間', '請假(假別)', '請假(小時)', '總加班(小時)', '綜合狀態分析']);

        Object.keys(userDateMap).sort().forEach(userName => {
          const dates = userDateMap[userName];
          Object.keys(dates).sort((a,b) => new Date(a) - new Date(b)).forEach(dateStr => {
            const data = dates[dateStr];
            let inTime = '', outTime = '', lateMins = 0, earlyMins = 0, finalOvertimeHours = 0, leaveStr = '';
            let statusArr = [];

            // 確保 dateStr 格式可被 new Date 正確解析 (YYYY/MM/DD)
            let actualDateObj = new Date(dateStr); 
            const holidayInfo = checkIsHoliday(actualDateObj, holidays);
            const weekdayStr = getWeekdayStr(dateStr).replace(/[()]/g, '');
            const userObj = users.find(u => u.id === data.userId);
            const isIgnoreLate = userObj?.ignoreLate || false;

            if (data.leave) {
              leaveStr = data.leave; 
              statusArr.push(`請假 (${data.leave} ${data.leaveHours}H)`);
            }
            
            let holidayPunchHours = 0;
            if (holidayInfo.isOff) {
               if (data.in && data.out) holidayPunchHours = (new Date(data.out.timestamp) - new Date(data.in.timestamp)) / 3600000;
               if (data.in) inTime = new Date(data.in.timestamp).toLocaleTimeString('zh-TW');
               if (data.out) outTime = new Date(data.out.timestamp).toLocaleTimeString('zh-TW');
            } else {
               if (data.in) {
                 const d = new Date(data.in.timestamp); inTime = d.toLocaleTimeString('zh-TW');
                 const limit = new Date(d); limit.setHours(8, 30, 0, 0);
                 if (d > limit && !data.leave && !isIgnoreLate) { lateMins = Math.floor((d - limit) / 60000); statusArr.push(`遲到 ${formatMins(lateMins)}`); }
               } else if (!data.leave) { statusArr.push('缺上班卡'); }

               if (data.out) {
                 const d = new Date(data.out.timestamp); outTime = d.toLocaleTimeString('zh-TW');
                 const limit = new Date(d); limit.setHours(17, 30, 0, 0);
                 if (d < limit && !data.leave) { earlyMins = Math.floor((limit - d) / 60000); statusArr.push(`早退 ${formatMins(earlyMins)}`); }
               } else if (!data.leave) { statusArr.push('缺下班卡'); }
            }

            // 計算最終加班：假日打卡時數 + 手動加班單，單日上限 8 小時
            finalOvertimeHours = Math.min(8, holidayPunchHours + data.overtimeHours);
            if (holidayInfo.isOff && holidayPunchHours > 0) statusArr.push(`假日打卡 (${holidayInfo.name})`);
            if (data.overtimeHours > 0) statusArr.push(`核准加班 ${data.overtimeHours}H`);

            if (statusArr.length === 0) statusArr.push('正常出勤');

            rows.push([ userName, dateStr, weekdayStr, inTime || '--', outTime || '--', formatMins(lateMins), formatMins(earlyMins), leaveStr || '--', data.leaveHours || 0, Number(finalOvertimeHours).toFixed(1), statusArr.join(' / ') ]);
          });
        });

        const ws = window.XLSX.utils.aoa_to_sheet(rows);
        
        // 💎 專業美化
        const range = window.XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRef = window.XLSX.utils.encode_cell({r: R, c: C});
            if (!ws[cellRef]) continue;
            if (R === 0) {
              ws[cellRef].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "4F81BD" } }, alignment: { horizontal: "center", vertical: "center" }, border: { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} } };
            } else {
              ws[cellRef].s = { alignment: { horizontal: "center", vertical: "center" } };
              if (ws[cellRef].v && typeof ws[cellRef].v === 'string') {
                 if (ws[cellRef].v.includes('遲到') || ws[cellRef].v.includes('早退') || ws[cellRef].v.includes('缺')) ws[cellRef].s.font = { color: { rgb: "C00000" }, bold: true }; 
                 else if (ws[cellRef].v.includes('請假')) ws[cellRef].s.font = { color: { rgb: "7030A0" }, bold: true }; 
                 else if (ws[cellRef].v.includes('加班')) ws[cellRef].s.font = { color: { rgb: "E36C09" }, bold: true }; 
              }
            }
          }
        }
        ws['!cols'] = [{wch: 12}, {wch: 12}, {wch: 8}, {wch: 12}, {wch: 12}, {wch: 12}, {wch: 12}, {wch: 12}, {wch: 10}, {wch: 12}, {wch: 35}];
        window.XLSX.utils.book_append_sheet(wb, ws, monthStr);
      });

      let dateStr = '全部';
      if(startDate && endDate) dateStr = `${startDate.replace(/-/g, '')}-${endDate.replace(/-/g, '')}`;
      else if(startDate) dateStr = `${startDate.replace(/-/g, '')}起`;
      else if(endDate) dateStr = `至${endDate.replace(/-/g, '')}`;

      window.XLSX.writeFile(wb, `出勤請假報表_${dateStr}.xlsx`);
      showToast('專業版 Excel 報表匯出成功！', 'success');
    } catch (e) { console.error(e); showToast('報表匯出失敗', 'error'); }
  };

  const startEditRecord = (record) => {
    setEditingRecord(record);
    const d = new Date(record.timestamp);
    setEditDateTime(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
  };

  const handleSaveRecord = () => {
    if (!editDateTime) return;
    onEditRecord(editingRecord.docId, new Date(editDateTime).toISOString());
    setEditingRecord(null);
  };

  return (
    <div className="animate-fade-in w-full">
      {editingRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-5 sm:p-6 w-full max-w-sm animate-fade-in-down shadow-2xl">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><Edit2 className="w-5 h-5 mr-2 text-blue-600" />修改打卡時間</h3>
            <div className="mb-4 space-y-2"><p className="text-sm text-gray-600">員工：<span className="font-bold text-gray-900">{editingRecord.userName}</span></p><div className="pt-2"><label className="block text-xs font-bold text-gray-700 mb-1">新的時間</label><input type="datetime-local" value={editDateTime} onChange={(e) => setEditDateTime(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div></div>
            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100"><button onClick={() => setEditingRecord(null)} className="px-4 py-2 bg-gray-100 text-gray-600 font-bold rounded-lg text-sm hover:bg-gray-200">取消</button><button onClick={handleSaveRecord} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg text-sm hover:bg-blue-700 shadow-md">儲存修改</button></div>
          </div>
        </div>
      )}

      {recordToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-5 sm:p-6 w-full max-w-sm animate-fade-in-down shadow-2xl">
            <h3 className="text-lg font-bold text-red-600 mb-3 flex items-center"><AlertCircle className="w-5 h-5 mr-2" />確認刪除</h3>
            <div className="mb-5 space-y-2">
              <p className="text-sm text-gray-600">確定要刪除這筆紀錄嗎？</p>
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 mt-2"><p className="text-sm font-bold text-gray-800">{recordToDelete.userName}</p><p className="text-xs text-gray-500 mt-1">{recordToDelete.eventCategory !== 'punch' ? <span className="mr-2 font-bold">{recordToDelete.eventCategory==='leave'?`請假 (${recordToDelete.leaveType})`:`加班 ${recordToDelete.hours}H`}</span> : <span className="mr-2 font-bold">{recordToDelete.type === 'in' ? '上班' : '下班'}</span>}{recordToDelete.eventCategory==='punch'?new Date(recordToDelete.timestamp).toLocaleString('zh-TW'):recordToDelete.date}</p></div>
            </div>
            <div className="flex justify-end gap-2"><button onClick={() => setRecordToDelete(null)} className="px-4 py-2 bg-gray-100 font-bold text-gray-600 rounded-lg text-sm">取消</button><button onClick={() => { recordToDelete.eventCategory!=='punch' ? onDeleteForm(recordToDelete.docId, recordToDelete.eventCategory) : onDeleteRecord(recordToDelete.docId); setRecordToDelete(null); }} className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg text-sm shadow-md">確定刪除</button></div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between mb-4 sm:mb-6 gap-3">
        <h2 className="text-xl font-bold text-gray-800 flex items-center"><List className="w-5 h-5 mr-2 text-blue-600" />明細查詢</h2>
        <button onClick={handleExportExcel} disabled={filteredEvents.length === 0} className={`px-4 py-2.5 rounded-lg font-bold flex items-center shadow-sm active:scale-95 transition-all ${filteredEvents.length === 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}><Download className="w-4 h-4 mr-2" />匯出報表</button>
      </div>

      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 sm:p-5 mb-6 flex flex-col lg:flex-row gap-4">
        <div className="flex-1 w-full"><label className="block text-sm font-bold text-gray-700 mb-1.5">日期區間</label><div className="flex items-center gap-1.5"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-2 py-2 border rounded-lg text-sm bg-white" /><span className="text-gray-400 font-bold shrink-0">~</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} className="w-full px-2 py-2 border rounded-lg text-sm bg-white" /></div></div>
        <div className="flex gap-3 flex-1 w-full">
          <div className="flex-1"><label className="block text-sm font-bold text-gray-700 mb-1.5">員工</label><select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className="w-full px-2 py-2 border rounded-lg bg-white text-sm"><option value="">全部</option>{users.filter(u => u.role !== 'admin').map(u => <option key={u.docId} value={u.id}>{u.name}</option>)}</select></div>
          <div className="flex-1"><label className="block text-sm font-bold text-gray-700 mb-1.5">項目</label><select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full px-2 py-2 border rounded-lg bg-white text-sm"><option value="">全部</option><option value="punch_in">上班打卡</option><option value="punch_out">下班打卡</option><option value="leave_annual">請假 (年假)</option><option value="leave_comp">請假 (補休)</option><option value="leave_personal">請假 (事假)</option><option value="leave_sick">請假 (病假)</option><option value="overtime">核准加班</option></select></div>
        </div>
        <div className="flex items-end w-full lg:w-auto"><button onClick={() => { setStartDate(''); setEndDate(''); setFilterUserId(''); setFilterType(''); }} className="w-full px-4 py-2 text-gray-600 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-sm font-bold shadow-sm"><X className="w-4 h-4 inline mr-1" />清除</button></div>
      </div>
      
      {filteredEvents.length === 0 ? (
        <div className="text-center py-16 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300"><List className="w-12 h-12 mx-auto text-gray-300 mb-3" /><p>找不到符合條件的紀錄</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 w-full shadow-sm">
          <table className="w-full text-left bg-white min-w-[700px]">
            <thead>
              <tr className="bg-gray-100/80 text-gray-700 text-sm border-b">
                <th className="p-3 font-bold">員工</th><th className="p-3 font-bold">項目</th><th className="p-3 font-bold">日期</th><th className="p-3 font-bold">時間 / 細節</th><th className="p-3 font-bold">狀態</th><th className="p-3 font-bold text-center w-20">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredEvents.map((r, idx) => {
                let dateDisp = r.eventCategory === 'punch' ? `${new Date(r.timestamp).toLocaleDateString('zh-TW')} ${getWeekdayStr(r.timestamp)}` : `${r.date.replace(/-/g,'/')} ${getWeekdayStr(r.date)}`;
                let detailDisp = r.eventCategory === 'punch' ? new Date(r.timestamp).toLocaleTimeString('zh-TW') : (r.eventCategory === 'leave' ? `請假：${r.leaveType} ${r.hours || 8}H` : `核准加班：${r.hours}H`);
                const status = getRecordStatusUI(r);
                return (
                  <tr key={r.docId || idx} className="hover:bg-blue-50/50">
                    <td className="p-3 font-bold text-gray-900">{r.userName}</td>
                    <td className="p-3">
                      {r.eventCategory === 'leave' ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">請假</span> : 
                       r.eventCategory === 'overtime' ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">加班單</span> : 
                       <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.type === 'in' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.type === 'in' ? '上班' : '下班'}</span>}
                    </td>
                    <td className="p-3 text-sm text-gray-700 font-medium">{dateDisp}</td>
                    <td className="p-3 text-sm text-gray-700 font-mono">{detailDisp}</td>
                    <td className="p-3">
                      {r.eventCategory === 'leave' ? (
                         <span className={`font-bold text-xs px-2 py-1 rounded-md ${r.leaveType==='年假'?'bg-purple-50 text-purple-600':r.leaveType==='補休'?'bg-indigo-50 text-indigo-600':'bg-pink-50 text-pink-600'}`}>{r.leaveType}</span>
                      ) : status.isAnomaly ? (
                        <span className={`font-bold text-xs px-2 py-1 rounded-md ${status.type === 'holiday' ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'}`}>{status.text}</span>
                      ) : ( <span className="text-emerald-600 text-xs">{status.text}</span> )}
                    </td>
                    <td className="p-3 text-center whitespace-nowrap">
                      {r.eventCategory === 'punch' && <button onClick={() => startEditRecord(r)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 className="w-4 h-4 inline-block" /></button>}
                      <button onClick={() => setRecordToDelete(r)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 ml-1"><Trash2 className="w-4 h-4 inline-block" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- 員工管理 ---
function AdminUsersView({ users, leaves, overtimes, onAddUser, onEditUser, onDeleteUser, onUpdateUserIP, currentUser }) {
  const getTodayString = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  
  const [newUsername, setNewUsername] = useState(''); const [newPassword, setNewPassword] = useState(''); const [newName, setNewName] = useState(''); const [newRole, setNewRole] = useState('employee'); const [newAllowedIP, setNewAllowedIP] = useState('');
  const [newEmail, setNewEmail] = useState(''); const [newAnnualLeave, setNewAnnualLeave] = useState(0);
  const [newHireDate, setNewHireDate] = useState(getTodayString());
  const [newIgnoreLate, setNewIgnoreLate] = useState(false); const [newIgnoreIpRestriction, setNewIgnoreIpRestriction] = useState(false);
  
  const [editingIpUserId, setEditingIpUserId] = useState(null); const [editIpValue, setEditIpValue] = useState(''); const [userToDelete, setUserToDelete] = useState(null);
  const [editingUser, setEditingUser] = useState(null); const [editFormData, setEditFormData] = useState({ name: '', username: '', password: '', role: '', allowedIP: '', email: '', annualLeaveTotal: 0, hireDate: '', ignoreLate: false, ignoreIpRestriction: false, id: '' });

  // 選擇到職日時，自動帶入勞基法特休天數
  const handleNewHireDateChange = (dateVal) => {
    setNewHireDate(dateVal);
    setNewAnnualLeave(calculateTaiwanAnnualLeave(dateVal));
  };

  const handleEditHireDateChange = (dateVal) => {
    setEditFormData(prev => ({...prev, hireDate: dateVal, annualLeaveTotal: calculateTaiwanAnnualLeave(dateVal)}));
  };

  const handleSubmit = (e) => {
    e.preventDefault(); if (!newUsername || !newPassword || !newName) return;
    onAddUser({ username: newUsername, password: newPassword, name: newName, role: newRole, allowedIP: newAllowedIP.trim(), email: newEmail.trim(), annualLeaveTotal: Number(newAnnualLeave), hireDate: newHireDate, ignoreLate: newIgnoreLate, ignoreIpRestriction: newIgnoreIpRestriction });
    setNewUsername(''); setNewPassword(''); setNewName(''); setNewRole('employee'); setNewAllowedIP(''); setNewEmail(''); setNewAnnualLeave(0); setNewHireDate(getTodayString()); setNewIgnoreLate(false); setNewIgnoreIpRestriction(false);
  };

  const startFullEdit = (user) => {
    setEditingUser(user);
    setEditFormData({
      id: user.id, name: user.name, username: user.username, password: user.password, role: user.role, 
      allowedIP: user.allowedIP || '', email: user.email || '', annualLeaveTotal: user.annualLeaveTotal || 0, hireDate: user.hireDate || '',
      ignoreLate: user.ignoreLate || false, ignoreIpRestriction: user.ignoreIpRestriction || false
    });
  };

  const handleSaveEdit = () => { if (!editFormData.name || !editFormData.username || !editFormData.password) return; onEditUser(editingUser.docId, editFormData); setEditingUser(null); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in relative">
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-5 sm:p-6 w-full max-w-md animate-fade-in-down shadow-2xl"><h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 flex items-center"><Edit2 className="w-5 h-5 mr-2 text-blue-600" />編輯員工資料</h3>
            <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto px-1">
              <div className="col-span-2"><label className="block text-xs font-bold text-gray-700 mb-1">姓名</label><input type="text" required value={editFormData.name} onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
              <div className="col-span-2"><label className="block text-xs font-bold text-gray-700 mb-1">Email 信箱</label><input type="email" value={editFormData.email} onChange={(e) => setEditFormData({...editFormData, email: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
              <div className="col-span-1"><label className="block text-xs font-bold text-gray-700 mb-1">登入帳號</label><input type="text" required value={editFormData.username} onChange={(e) => setEditFormData({...editFormData, username: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
              <div className="col-span-1"><label className="block text-xs font-bold text-gray-700 mb-1">登入密碼</label><input type="text" required value={editFormData.password} onChange={(e) => setEditFormData({...editFormData, password: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
              <div className="col-span-1"><label className="block text-xs font-bold text-gray-700 mb-1">到職日</label><input type="date" value={editFormData.hireDate} onChange={(e) => handleEditHireDateChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-emerald-50" /></div>
              <div className="col-span-1"><label className="block text-xs font-bold text-gray-700 mb-1">年假總額(天)</label><input type="number" min="0" value={editFormData.annualLeaveTotal} onChange={(e) => setEditFormData({...editFormData, annualLeaveTotal: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500" /></div>
              <div className="col-span-1"><label className="block text-xs font-bold text-gray-700 mb-1">權限</label><select value={editFormData.role} onChange={(e) => setEditFormData({...editFormData, role: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"><option value="employee">一般員工</option><option value="admin">管理員</option></select></div>
              <div className="col-span-2"><label className="block text-xs font-bold text-gray-700 mb-1">IP 限制 (選填)</label><input type="text" value={editFormData.allowedIP} onChange={(e) => setEditFormData({...editFormData, allowedIP: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500" placeholder="支援網段或單一IP" /></div>
              <div className="col-span-2 flex flex-wrap gap-4 mt-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
                <label className="flex items-center text-xs font-bold text-gray-700 cursor-pointer"><input type="checkbox" checked={editFormData.ignoreLate} onChange={(e) => setEditFormData({...editFormData, ignoreLate: e.target.checked})} className="mr-1.5 focus:ring-blue-500" />不計遲到 (彈性上班)</label>
                <label className="flex items-center text-xs font-bold text-gray-700 cursor-pointer"><input type="checkbox" checked={editFormData.ignoreIpRestriction} onChange={(e) => setEditFormData({...editFormData, ignoreIpRestriction: e.target.checked})} className="mr-1.5 focus:ring-blue-500" />無視 IP 限制</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100"><button onClick={() => setEditingUser(null)} className="px-4 py-2 bg-gray-100 text-gray-600 font-bold rounded-lg text-sm">取消</button><button onClick={handleSaveEdit} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg text-sm">儲存修改</button></div>
          </div>
        </div>
      )}
      {userToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-5 sm:p-6 w-full max-w-sm shadow-2xl"><h3 className="text-lg font-bold text-red-600 mb-3"><AlertCircle className="w-5 h-5 inline mr-2" />確認刪除</h3><p className="mb-5 text-sm">確定要刪除「{userToDelete.name}」嗎？</p><div className="flex justify-end gap-2"><button onClick={() => setUserToDelete(null)} className="px-4 py-2 bg-gray-100 font-bold text-gray-600 rounded-lg text-sm">取消</button><button onClick={() => { onDeleteUser(userToDelete.docId, userToDelete.id, userToDelete.name); setUserToDelete(null); }} className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg text-sm">確定刪除</button></div></div>
        </div>
      )}

      <div className="lg:col-span-2">
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center"><Users className="w-5 h-5 mr-2 text-blue-600" />系統員工 ({users.length})</h2>
        <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
          <ul className="divide-y divide-gray-100">
            {users.map(u => {
              const uEarnedComp = overtimes.filter(o => o.userId === u.id && o.status === 'approved').reduce((sum, o) => sum + Number(o.hours), 0);
              const uUsedComp = leaves.filter(l => l.userId === u.id && l.leaveType === '補休' && l.status !== 'rejected').reduce((sum, l) => sum + (Number(l.hours) || 8), 0);
              const uRemainComp = uEarnedComp - uUsedComp;

              return (
                <li key={u.docId} className="p-4 flex flex-col sm:flex-row justify-between gap-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start sm:items-center gap-3 w-full">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 mt-1 sm:mt-0 ${u.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>{u.name.charAt(0)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-900 text-base flex flex-wrap items-center gap-2"><span className="truncate">{u.name}</span>{u.id === currentUser.id && <span className="text-[10px] bg-gray-200 px-2 py-0.5 rounded-full shrink-0 text-gray-600">您自己</span>}</div>
                      <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-2">
                        <span><span className="font-mono">@{u.username}</span></span>
                        {u.email && <span>| <Mail className="w-3 h-3 inline mr-1 -mt-0.5"/>{u.email}</span>}
                        {u.hireDate && <span className="text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">到職: {u.hireDate.replace(/-/g, '/')} ({formatTenure(u.hireDate)})</span>}
                      </div>
                      <div className="text-[10px] sm:text-xs text-gray-500 mt-2 flex flex-wrap items-center gap-2">
                        <div className="bg-blue-50 text-blue-700 px-2 py-1 rounded-md font-bold border border-blue-100">年假: {u.annualLeaveTotal || 0} 天</div>
                        <div className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md font-bold border border-indigo-100">補休餘額: {uRemainComp} H</div>
                        {u.ignoreLate && <div className="bg-rose-50 text-rose-700 px-2 py-1 rounded-md font-bold border border-rose-100">不計遲到</div>}
                        {u.ignoreIpRestriction && <div className="bg-amber-50 text-amber-700 px-2 py-1 rounded-md font-bold border border-amber-100">無視IP</div>}
                        <div className="flex items-center bg-gray-100/80 px-2 py-1 rounded-md">
                          <Globe className="w-3.5 h-3.5 mr-1" /> IP限制: 
                          {editingIpUserId === u.docId ? (
                            <div className="flex ml-2"><input type="text" value={editIpValue} onChange={(e) => setEditIpValue(e.target.value)} className="border rounded px-1 text-xs w-32 focus:outline-none focus:border-blue-500" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { onUpdateUserIP(u.docId, editIpValue.trim()); setEditingIpUserId(null); } if (e.key === 'Escape') setEditingIpUserId(null); }} /><button onClick={() => { onUpdateUserIP(u.docId, editIpValue.trim()); setEditingIpUserId(null); }} className="ml-1 bg-green-500 text-white px-2 py-0.5 rounded text-xs font-bold">儲存</button><button onClick={() => setEditingIpUserId(null)} className="ml-1 bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-xs font-bold">取消</button></div>
                          ) : (
                            <div className="flex items-center ml-1">{u.allowedIP ? <span className="text-blue-600 font-mono font-bold truncate max-w-[120px]">{u.allowedIP}</span> : <span className="text-gray-400">無限制</span>}<button onClick={() => { setEditingIpUserId(u.docId); setEditIpValue(u.allowedIP || ''); }} className="ml-2 text-blue-500 hover:text-blue-700 p-0.5"><Edit2 className="w-3 h-3" /></button></div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 sm:pt-0 mt-2 sm:mt-0 border-t border-gray-100 sm:border-0">
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold mr-2 ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>{u.role === 'admin' ? '管理員' : '一般員工'}</span>
                    <button onClick={() => startFullEdit(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setUserToDelete({ docId: u.docId, id: u.id, name: u.name })} disabled={u.id === currentUser.id} className={`p-1.5 rounded-lg ${u.id === currentUser.id ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="w-full">
        <div className="bg-blue-50/50 rounded-xl p-5 border border-blue-100 lg:sticky lg:top-24 shadow-sm">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><UserPlus className="w-5 h-5 mr-2 text-blue-600" />新增帳號</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="block text-xs font-bold text-gray-700 mb-1">姓名</label><input type="text" required value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-xs font-bold text-gray-700 mb-1">Email 信箱 (寄信用)</label><input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" placeholder="arok276@gmail.com" /></div>
            <div className="flex gap-2">
               <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1">登入帳號</label><input type="text" required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
               <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1">登入密碼</label><input type="text" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
            </div>
            <div className="flex gap-2">
               <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1 text-emerald-700">到職日 (自動算特休)</label><input type="date" required value={newHireDate} onChange={(e) => handleNewHireDateChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm bg-emerald-50 focus:ring-2 focus:ring-emerald-500" /></div>
               <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1">年假總額(天)</label><input type="number" min="0" required value={newAnnualLeave} onChange={(e) => setNewAnnualLeave(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500" /></div>
            </div>
            <div><label className="block text-xs font-bold text-gray-700 mb-1">權限</label><select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"><option value="employee">一般員工</option><option value="admin">管理員</option></select></div>
            <div><label className="block text-xs font-bold text-gray-700 mb-1">IP 限制 (選填)</label><input type="text" value={newAllowedIP} onChange={(e) => setNewAllowedIP(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500" /></div>
            <div className="flex gap-4 mt-2">
               <label className="flex items-center text-xs font-bold text-gray-700 cursor-pointer"><input type="checkbox" checked={newIgnoreLate} onChange={(e) => setNewIgnoreLate(e.target.checked)} className="mr-1.5 focus:ring-blue-500" />不計遲到</label>
               <label className="flex items-center text-xs font-bold text-gray-700 cursor-pointer"><input type="checkbox" checked={newIgnoreIpRestriction} onChange={(e) => setNewIgnoreIpRestriction(e.target.checked)} className="mr-1.5 focus:ring-blue-500" />無視 IP</label>
            </div>
            <button type="submit" className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-lg flex justify-center text-sm shadow-md active:scale-95 transition-all">建立帳號</button>
          </form>
        </div>
      </div>
    </div>
  );
}

// --- 紀念日及節日管理 ---
function AdminHolidaysView({ holidays, onAddHoliday, onDeleteHoliday, onImportTaiwanHolidays, readOnly = false }) {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(null); 
  const [holidayName, setHolidayName] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const months = Array.from({length: 12}, (_, i) => i + 1);
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  const handleDateClick = (year, month, day) => {
    if (readOnly) return; 
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const existing = holidays.find(h => h.date === dateStr);
    setSelectedDate({ date: dateStr, existing });
    setHolidayName(existing ? existing.name : '');
  };

  const handleSaveModal = () => {
    if (!selectedDate.existing && holidayName.trim()) onAddHoliday(selectedDate.date, holidayName.trim());
    setSelectedDate(null);
  };

  const handleImport = async () => {
    if (onImportTaiwanHolidays) {
      setIsImporting(true);
      await onImportTaiwanHolidays(currentYear);
      setIsImporting(false);
    }
  };

  return (
    <div className="animate-fade-in relative">
      {!readOnly && selectedDate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm animate-fade-in-down shadow-2xl">
            <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center"><CalendarDays className="w-5 h-5 mr-2 text-amber-600" />{selectedDate.existing ? '編輯/移除 節日' : '設定為紀念日或節日'}</h3>
            <p className="text-sm text-gray-500 mb-4 font-mono bg-gray-50 p-2 rounded border border-gray-100 text-center">{selectedDate.date.replace(/-/g, ' / ')}</p>
            {selectedDate.existing ? (
              <div className="mb-6 text-center"><p className="text-amber-700 font-bold text-xl mb-2 bg-amber-50 py-3 rounded-lg border border-amber-200">{selectedDate.existing.name}</p><p className="text-xs text-red-500 mt-3 font-bold">點擊下方按鈕以移除此節日，恢復為一般工作日</p></div>
            ) : (
              <div className="mb-6"><label className="block text-xs font-bold text-gray-700 mb-1.5">請輸入節日或休假名稱</label><input type="text" value={holidayName} onChange={e => setHolidayName(e.target.value)} placeholder="例如：端午節、公司創立紀念日" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500" autoFocus /></div>
            )}
            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
              <button onClick={() => setSelectedDate(null)} className="px-4 py-2 bg-gray-100 text-gray-600 font-bold rounded-lg text-sm hover:bg-gray-200">取消</button>
              {selectedDate.existing ? (
                <button onClick={() => { onDeleteHoliday(selectedDate.existing.docId); setSelectedDate(null); }} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-sm shadow-md">移除節日</button>
              ) : (
                <button onClick={handleSaveModal} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-sm shadow-md">儲存設定</button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between mb-6 bg-white p-4 rounded-xl border border-gray-200 shadow-sm gap-4">
        <div><h2 className="text-xl font-bold text-gray-800 flex items-center"><CalendarDays className="w-6 h-6 mr-2 text-amber-600" />紀念日及節日行事曆</h2><p className="text-xs text-gray-500 mt-1">{readOnly ? '此日曆標示出公司全年的國定紀念日與節日，供請假參考。' : '點擊日曆上的日期即可快速手動設定，或直接點擊右側自動匯入。'}</p></div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 bg-gray-50 px-2 py-1 rounded-lg border border-gray-200">
          <div className="flex items-center gap-1">
             <button onClick={() => setCurrentYear(y => y - 1)} className="p-2 hover:bg-white rounded-md transition-colors text-gray-600 hover:text-amber-600 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
             <span className="text-xl font-bold text-gray-800 font-mono">{currentYear} 年</span>
             <button onClick={() => setCurrentYear(y => y + 1)} className="p-2 hover:bg-white rounded-md transition-colors text-gray-600 hover:text-amber-600 shadow-sm"><ChevronRight className="w-5 h-5" /></button>
          </div>
          {!readOnly && (
             <button onClick={handleImport} disabled={isImporting} className={`ml-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${isImporting ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-100 text-blue-700 hover:bg-blue-200 hover:shadow'}`}>
               {isImporting ? '匯入中...' : '⚡ 自動匯入台灣假日'}
             </button>
          )}
        </div>
      </div>

      <div className="flex gap-4 mb-4 text-xs font-bold text-gray-600 justify-end px-2"><div className="flex items-center"><span className="w-3 h-3 rounded-sm bg-gray-200 mr-1.5 inline-block"></span>預設週末</div><div className="flex items-center"><span className="w-3 h-3 rounded-sm bg-amber-400 mr-1.5 inline-block"></span>已設節日</div></div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
        {months.map(month => {
          const daysInMonth = new Date(currentYear, month, 0).getDate(); const firstDay = new Date(currentYear, month - 1, 1).getDay();
          const days = Array.from({length: daysInMonth}, (_, i) => i + 1); const blanks = Array.from({length: firstDay}, (_, i) => i);
          return (
            <div key={month} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
               <h4 className="text-center font-bold text-gray-800 mb-3 text-lg border-b border-gray-100 pb-2">{month} 月</h4>
               <div className="grid grid-cols-7 text-center text-xs font-bold text-gray-400 mb-2">{weekDays.map((wd, i) => <div key={wd} className={i===0||i===6?'text-rose-400':''}>{wd}</div>)}</div>
               <div className="grid grid-cols-7 text-center gap-1 sm:gap-1.5">
                 {blanks.map(b => <div key={`blank-${b}`}></div>)}
                 {days.map(day => {
                   const dateStr = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                   const holiday = holidays.find(h => h.date === dateStr);
                   const isWeekend = new Date(currentYear, month - 1, day).getDay() === 0 || new Date(currentYear, month - 1, day).getDay() === 6;
                   let bgClass = "bg-white border border-gray-100 text-gray-700";
                   if (!readOnly) bgClass += " hover:border-blue-300 hover:bg-blue-50";
                   if (holiday) { bgClass = "bg-amber-100 text-amber-800 font-bold border border-amber-300 shadow-sm scale-[1.05]"; if (!readOnly) bgClass += " hover:bg-amber-200"; } 
                   else if (isWeekend) { bgClass = "bg-gray-100 text-rose-500 border border-gray-100"; if (!readOnly) bgClass += " hover:bg-gray-200"; }
                   return (
                      <div key={day} onClick={() => handleDateClick(currentYear, month, day)} className={`py-1.5 rounded text-sm transition-all ${!readOnly ? 'cursor-pointer' : 'cursor-default'} ${bgClass}`} title={holiday ? holiday.name : (!readOnly ? '點擊設定為節日' : '')}>{day}</div>
                   )
                 })}
               </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}
