import { initializeApp } from "firebase/app";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    signOut,
    onAuthStateChanged
} from "firebase/auth";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    onSnapshot
} from "firebase/firestore";

// ----- Firebase Configuration -----
const firebaseConfig = {
    apiKey: "AIzaSyAdOJKAtKvCMJERGXtJb2nyx3Tk7LYnA3I",
    authDomain: "my-project-1-13e18.firebaseapp.com",
    projectId: "my-project-1-13e18",
    storageBucket: "my-project-1-13e18.firebasestorage.app",
    messagingSenderId: "628695847732",
    appId: "1:628695847732:web:03af3d8569762d29ce0b61"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

let db = null;
let hubDocRef = null;
try {
    db = getFirestore(app);
    hubDocRef = doc(db, "kuafi_hub", "global_state");
} catch (e) {
    console.warn("Firestore initialization warning:", e);
}

const FIREBASE_RTDB_REST_URL = `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com/kuafi_hub_global.json`;
const AUTO_POLL_INTERVAL_MS = 4500;
const ADMIN_GOOGLE_EMAILS = ['abdullahilkuafi@gmail.com', 'g4scumilla@gmail.com'];
const STORAGE_KEY = 'kuafi_hub_cloud_state_v2';
const THEME_STORAGE_KEY = 'kuafi_theme_mode';

// ----- Global State Flags & Variables -----
let isAdmin = false;
let isGoogleLoggedIn = false;
let isPreviewMode = false;
let isPushing = false;
let currentFilter = 'fav';
let isRearrangeMode = false;
let INITIAL_20_CARDS = [];

const DEFAULT_CATEGORIES = [
    { key: 'fav', label: 'Favourites', icon: 'fa-solid fa-star', iconColor: '#f59e0b' },
    { key: 'all', label: 'All Apps', icon: '', iconColor: '' },
    { key: 'live', label: 'Active Links', icon: '', iconColor: '' },
    { key: 'work', label: 'Work & Dev', icon: '', iconColor: '' },
    { key: 'life', label: 'Lifestyle', icon: '', iconColor: '' }
];

let appState = {
    updatedAt: 0,
    adminPin: '1234',
    favorites: ['app-dev', 'app-finance', 'app-sports'],
    cardOrder: [],
    cardsData: [],
    recycleBin: [],
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    notices: [
        { text: 'Welcome to Abdullahil Kuafi Smart Hub — Live Cloud Synced!', time: 'Just now', priority: 'normal' }
    ],
    gridCols: 3,
    gridStyleChoice: '1',
    gridLayoutChoice: '1',
    accentPrimary: '#3ded97',
    accentSecondary: '#06b6d4',
    scratchpad: '',
    accessMode: 'auto'
};

// ----- Helpers & Extractors -----
function extractInitialDomCards() {
    const els = Array.from(document.querySelectorAll('#app-grid .service-item'));
    return els.map(el => {
        const id = el.getAttribute('data-id');
        const cat = el.getAttribute('data-cat') || 'work';
        const live = el.getAttribute('data-live') === 'true';
        const href = el.getAttribute('href') || '#';
        const onclickAttr = el.getAttribute('onclick') || '';
        const title = el.querySelector('.card-title')?.innerText || '';
        const sub = el.querySelector('.card-sub')?.innerText || '';
        const icon = el.querySelector('.icon-circle i')?.className || 'fa-solid fa-cube';
        const style = el.getAttribute('style') || '';
        const c1Match = style.match(/--c1:\s*([^;]+)/);
        const c2Match = style.match(/--c2:\s*([^;]+)/);
        const rgbMatch = style.match(/--c-rgb:\s*([^;]+)/);

        return {
            id, title, sub, href, cat, live, icon, onclickAttr,
            c1: c1Match ? c1Match[1].trim() : '#3b82f6',
            c2: c2Match ? c2Match[1].trim() : '#6366f1',
            cRgb: rgbMatch ? rgbMatch[1].trim() : '59,130,246'
        };
    });
}

function isUserActivelyEditingForm() {
    const anyModalOpen = document.querySelector('.modal-backdrop.open') !== null;
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    const isTyping = (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT');
    return anyModalOpen || isTyping || isPreviewMode || isPushing;
}

function showSyncToast(message = '✓ Successfully Synced to Cloud!') {
    const toast = document.getElementById('sync-toast');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 2800);
}

function applyCloudStateToUI(incomingState, forceRender = false) {
    if (!incomingState || typeof incomingState !== 'object') return;
    const incomingTime = Number(incomingState.updatedAt || 0);
    const localTime = Number(appState.updatedAt || 0);

    if (!forceRender && incomingTime > 0 && incomingTime <= localTime) {
        return;
    }

    appState = { ...appState, ...incomingState };

    if (!appState.cardsData || appState.cardsData.length === 0) {
        appState.cardsData = JSON.parse(JSON.stringify(INITIAL_20_CARDS));
    }
    if (!appState.categories || appState.categories.length === 0) {
        appState.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }

    if (appState.gridCols) {
        document.documentElement.style.setProperty('--grid-cols', appState.gridCols);
        const gridSelect = document.getElementById('grid-cols-select');
        if (gridSelect) gridSelect.value = String(appState.gridCols);
    }

    if (appState.gridStyleChoice) {
        const styleSelect = document.getElementById('grid-style-select');
        if (styleSelect) styleSelect.value = String(appState.gridStyleChoice);
        applyCardGridStyleVars(appState.gridStyleChoice);
    }

    if (appState.gridLayoutChoice) {
        const layoutSelect = document.getElementById('grid-layout-select');
        if (layoutSelect) layoutSelect.value = String(appState.gridLayoutChoice);
        applyCardGridLayoutVars(appState.gridLayoutChoice);
    }

    if (appState.accentPrimary && appState.accentSecondary) {
        document.documentElement.style.setProperty('--accent', appState.accentPrimary);
        document.documentElement.style.setProperty('--accent-secondary', appState.accentSecondary);
        document.querySelectorAll('.swatch').forEach(s => {
            s.classList.toggle('active', s.getAttribute('data-primary') === appState.accentPrimary);
        });
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    renderCategories();
    renderServiceGrid();
    renderNotices();
    updateAuthAndAdminUI();
}

function pulseSyncBadge(label = 'Live') {
    const dot = document.getElementById('live-sync-dot');
    const txt = document.getElementById('live-sync-text');
    if (txt) txt.innerText = label;
    if (dot) {
        dot.classList.add('polling');
        setTimeout(() => dot.classList.remove('polling'), 600);
    }
}

// ----- Asynchronous External Component Loading (Header & Footer) -----
async function loadComponents() {
    try {
        const headerRes = await fetch('header.html');
        if (headerRes.ok) {
            const headerHtml = await headerRes.text();
            const headerPlaceholder = document.getElementById('header-placeholder');
            if (headerPlaceholder) headerPlaceholder.outerHTML = headerHtml;
        }
    } catch (e) {}

    try {
        const footerRes = await fetch('footer.html');
        if (footerRes.ok) {
            const footerHtml = await footerRes.text();
            const footerPlaceholder = document.getElementById('footer-placeholder');
            if (footerPlaceholder) footerPlaceholder.outerHTML = footerHtml;
        }
    } catch (e) {}
}

// ----- Initialization -----
async function initApp() {
    await loadComponents();
    INITIAL_20_CARDS = extractInitialDomCards();
    applySavedThemeOnLoad();

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            appState = { ...appState, ...parsed };
        } catch (e) {}
    }

    if (!appState.cardsData || appState.cardsData.length === 0) {
        appState.cardsData = JSON.parse(JSON.stringify(INITIAL_20_CARDS));
    }
    if (!appState.categories || appState.categories.length === 0) {
        appState.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }

    if (localStorage.getItem('kuafi_admin_unlocked') === 'true') {
        isAdmin = true;
    }

    onAuthStateChanged(auth, (user) => {
        if (user) {
            applyGoogleUser({
                name: user.displayName || 'Google User',
                email: user.email || '',
                avatar: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'U')}&background=3ded97&color=0b0f19`
            });
        } else {
            isGoogleLoggedIn = false;
            const loggedOutView = document.getElementById('google-logged-out-view');
            const loggedInView = document.getElementById('google-logged-in-view');
            if(loggedOutView) loggedOutView.style.display = 'flex';
            if(loggedInView) loggedInView.style.display = 'none';
            updateAuthAndAdminUI();
            filterApps(currentFilter);
        }
    });

    if (hubDocRef) {
        onSnapshot(hubDocRef, (snap) => {
            if (snap.exists() && !isUserActivelyEditingForm()) {
                applyCloudStateToUI(snap.data());
                pulseSyncBadge('Live');
            }
        }, (err) => {});
    }

    syncData(true);
    setInterval(() => {
        if (!document.hidden && !isUserActivelyEditingForm()) {
            syncData(false);
        }
    }, AUTO_POLL_INTERVAL_MS);

    if (appState.gridCols) {
        document.documentElement.style.setProperty('--grid-cols', appState.gridCols);
        const gridSelect = document.getElementById('grid-cols-select');
        if (gridSelect) gridSelect.value = String(appState.gridCols);
    }
    if (appState.gridStyleChoice) {
        const styleSelect = document.getElementById('grid-style-select');
        if (styleSelect) styleSelect.value = String(appState.gridStyleChoice);
        applyCardGridStyleVars(appState.gridStyleChoice);
    }
    if (appState.gridLayoutChoice) {
        const layoutSelect = document.getElementById('grid-layout-select');
        if (layoutSelect) layoutSelect.value = String(appState.gridLayoutChoice);
        applyCardGridLayoutVars(appState.gridLayoutChoice);
    }
    if (appState.accentPrimary && appState.accentSecondary) {
        document.documentElement.style.setProperty('--accent', appState.accentPrimary);
        document.documentElement.style.setProperty('--accent-secondary', appState.accentSecondary);
    }

    setAccessMode(appState.accessMode || 'auto', false);
    renderCategories();
    renderServiceGrid();
    renderNotices();
    updateAuthAndAdminUI();

    const homePage = document.getElementById('page-home');
    if (homePage) {
        const hash = window.location.hash.replace('#', '');
        if (hash && ['home', 'notices', 'tools'].includes(hash)) {
            setTimeout(() => switchPage(hash), 100);
        } else {
            goHomeWithFav();
        }
    }
}

// ----- UI, Themes, Mode Settings -----
function applySavedThemeOnLoad() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
    const isLight = (savedTheme === 'light');
    document.body.classList.toggle('light-mode', isLight);
    updateThemeButtonUI(isLight);
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem(THEME_STORAGE_KEY, isLight ? 'light' : 'dark');
    updateThemeButtonUI(isLight);
    applyCardGridStyleVars(appState.gridStyleChoice || '1');
}

function updateThemeButtonUI(isLight) {
    const themeText = document.getElementById('theme-text');
    const themeIcon = document.getElementById('theme-icon');
    if (themeText) themeText.innerText = isLight ? 'Light Mode' : 'Dark Mode';
    if (themeIcon) {
        themeIcon.className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
}

function setAccessMode(mode, save = true) {
    document.body.classList.remove('access-auto', 'access-android', 'access-tab', 'access-laptop', 'access-desktop');
    document.body.classList.add('access-' + mode);
    appState.accessMode = mode;

    document.querySelectorAll('#access-mode-pills .access-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });

    if (save) pushStateToCloud(false);
}

// ----- Authentication / Admin Check -----
async function loginWithGoogle() {
    const btnText = document.getElementById('google-login-btn-text');
    if (btnText) btnText.innerText = 'Signing in...';

    try {
        const result = await signInWithPopup(auth, googleProvider);
        if (result && result.user) {
            applyGoogleUser({
                name: result.user.displayName || 'Google User',
                email: result.user.email || '',
                avatar: result.user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(result.user.displayName || 'U')}&background=3ded97&color=0b0f19`
            });
        }
    } catch (error) {
        if (error.code === 'auth/popup-blocked') {
            await signInWithRedirect(auth, googleProvider);
            return;
        } else if (error.code !== 'auth/popup-closed-by-user') {
            alert('Google Sign-In Error: ' + (error.message || error.code));
        }
    } finally {
        if (btnText) btnText.innerText = 'Sign in with Google';
    }
}

function applyGoogleUser(user) {
    isGoogleLoggedIn = true;
    const loggedOutView = document.getElementById('google-logged-out-view');
    const loggedInView = document.getElementById('google-logged-in-view');
    if(loggedOutView) loggedOutView.style.display = 'none';
    if(loggedInView) loggedInView.style.display = 'flex';

    const emailKey = user.email || 'default';
    const customProfile = JSON.parse(localStorage.getItem(`kuafi_user_profile_${emailKey}`) || '{}');
    const finalName = customProfile.name || user.name || 'Welcome!';
    const finalEmail = user.email || '';

    const nameEl = document.getElementById('google-user-name');
    const emailEl = document.getElementById('google-user-email');
    const avatarEl = document.getElementById('google-user-avatar');

    if(nameEl) nameEl.innerText = finalName;
    if(emailEl) emailEl.innerText = finalEmail;
    if(avatarEl) avatarEl.src = user.avatar || 'https://ui-avatars.com/api/?name=User&background=3ded97&color=0b0f19';

    const previewEl = document.getElementById('profile-details-preview');
    if (previewEl) {
        previewEl.innerText = `${finalName} • ${customProfile.phone || 'No phone'} • ${customProfile.district || 'No district'}`;
    }

    if (user.email && ADMIN_GOOGLE_EMAILS.includes(user.email.toLowerCase())) {
        isAdmin = true;
        localStorage.setItem('kuafi_admin_unlocked', 'true');
    }

    renderCategories();
    renderServiceGrid();
    renderNotices();
    updateAuthAndAdminUI();
}

async function logoutGoogle() {
    try {
        await signOut(auth);
    } catch (e) {}

    isGoogleLoggedIn = false;
    const loggedOutView = document.getElementById('google-logged-out-view');
    const loggedInView = document.getElementById('google-logged-in-view');
    if(loggedOutView) loggedOutView.style.display = 'flex';
    if(loggedInView) loggedInView.style.display = 'none';

    updateAuthAndAdminUI();
    filterApps(currentFilter);
}

function updateAuthAndAdminUI() {
    document.body.classList.toggle('is-admin', isAdmin);
    document.body.classList.toggle('is-google-auth', isGoogleLoggedIn);

    const adminAccessSection = document.getElementById('admin-access-section');
    if (adminAccessSection) {
        adminAccessSection.style.display = (isAdmin || isGoogleLoggedIn) ? 'none' : 'block';
    }

    const googleAuthCard = document.getElementById('google-auth-card');
    if (googleAuthCard) {
        googleAuthCard.style.display = (isAdmin && !isGoogleLoggedIn) ? 'none' : 'block';
    }

    const binCount = (appState.recycleBin || []).length;
    const gridBinBadge = document.getElementById('grid-bin-count');
    const toolsBinBadge = document.getElementById('tools-bin-count');
    if (gridBinBadge) gridBinBadge.innerText = binCount;
    if (toolsBinBadge) toolsBinBadge.innerText = binCount;

    const favLabel = document.getElementById('fav-count-label');
    if (favLabel) favLabel.innerText = `${(appState.favorites || []).length} apps pinned to Favourites`;

    const notesArea = document.getElementById('quick-notes');
    if (notesArea && document.activeElement !== notesArea) {
        notesArea.value = appState.scratchpad || '';
    }
}

// ----- Grid Category Filters -----
function renderCategories() {
    const container = document.getElementById('filter-pills-container');
    if (!container) return; 

    container.innerHTML = '';

    appState.categories.forEach((cat, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'pill-wrapper';

        const btn = document.createElement('button');
        btn.className = 'pill' + (currentFilter === cat.key ? ' active' : '');
        btn.id = 'pill-' + cat.key;
        btn.setAttribute('data-filter', cat.key);
        btn.onclick = () => filterApps(cat.key, btn);

        const iconHtml = cat.icon ? `<i class="${cat.icon}" style="color: ${cat.iconColor || 'inherit'}; margin-right: 4px;"></i>` : '';
        btn.innerHTML = `${iconHtml}${cat.label}`;
        wrap.appendChild(btn);

        if (isAdmin) {
            const adminBar = document.createElement('div');
            adminBar.className = 'pill-admin-actions';
            adminBar.innerHTML = `
                <button class="pill-mini-btn" title="Move Left" onclick="moveCategory(${idx}, -1)"><i class="fa-solid fa-chevron-left"></i></button>
                <button class="pill-mini-btn" title="Edit" onclick="editCategoryPrompt('${cat.key}')"><i class="fa-solid fa-pen"></i></button>
                <button class="pill-mini-btn del" title="Delete" onclick="deleteCategory('${cat.key}')"><i class="fa-solid fa-trash"></i></button>
                <button class="pill-mini-btn" title="Move Right" onclick="moveCategory(${idx}, 1)"><i class="fa-solid fa-chevron-right"></i></button>
            `;
            wrap.appendChild(adminBar);
        }
        container.appendChild(wrap);
    });

    const catSelect = document.getElementById('card-cat-input');
    if (catSelect) {
        catSelect.innerHTML = appState.categories
            .filter(c => c.key !== 'fav' && c.key !== 'all' && c.key !== 'live')
            .map(c => `<option value="${c.key}">${c.label}</option>`)
            .join('');
    }
}

function moveCategory(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= appState.categories.length) return;
    const temp = appState.categories[idx];
    appState.categories[idx] = appState.categories[target];
    appState.categories[target] = temp;
    renderCategories();
    pushStateToCloud(false);
}

function editCategoryPrompt(key) {
    const cat = appState.categories.find(c => c.key === key);
    if (!cat) return;
    const newName = prompt('Edit Category Title:', cat.label);
    if (newName && newName.trim()) {
        cat.label = newName.trim();
        renderCategories();
        pushStateToCloud(false);
    }
}

function deleteCategory(key) {
    if (key === 'fav' || key === 'all') {
        alert('Favourites and All Apps are core tabs and cannot be removed.');
        return;
    }
    if (!confirm(`Delete category "${key}" and sync to all users?`)) return;
    appState.categories = appState.categories.filter(c => c.key !== key);
    if (currentFilter === key) currentFilter = 'fav';
    renderCategories();
    filterApps(currentFilter, document.getElementById('pill-' + currentFilter));
    pushStateToCloud(false);
}

function openCategoryModal() {
    const list = document.getElementById('category-manager-list');
    if(!list) return;
    list.innerHTML = appState.categories.map((c, i) => `
        <div class="bin-item">
            <span style="font-size:12.5px; font-weight:600;">${c.label} <small style="color:var(--text-secondary);">(${c.key})</small></span>
            <div style="display:flex; gap:4px;">
                <button class="card-ctrl-btn" onclick="moveCategory(${i}, -1); openCategoryModal();"><i class="fa-solid fa-arrow-up"></i></button>
                <button class="card-ctrl-btn" onclick="moveCategory(${i}, 1); openCategoryModal();"><i class="fa-solid fa-arrow-down"></i></button>
                <button class="card-ctrl-btn" onclick="editCategoryPrompt('${c.key}'); openCategoryModal();"><i class="fa-solid fa-pen"></i></button>
                ${(c.key !== 'fav' && c.key !== 'all') ? `<button class="card-ctrl-btn danger" onclick="deleteCategory('${c.key}'); openCategoryModal();"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>
        </div>
    `).join('');
    document.getElementById('cat-label-input').value = '';
    document.getElementById('cat-key-input').value = '';
    openModal('category-modal');
}

function saveCategoryItem() {
    const label = document.getElementById('cat-label-input').value.trim();
    const key = document.getElementById('cat-key-input').value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!label || !key) return alert('Please enter both a category name and key.');

    const existing = appState.categories.find(c => c.key === key);
    if (existing) {
        existing.label = label;
    } else {
        appState.categories.push({ key, label, icon: '', iconColor: '' });
    }

    renderCategories();
    openCategoryModal();
    pushStateToCloud(false);
}

function resetDefaultCategories() {
    appState.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    renderCategories();
    openCategoryModal();
    pushStateToCloud(false);
}

// ----- Service Cards Core Processing -----
function renderServiceGrid() {
    const grid = document.getElementById('app-grid');
    const emptyMsg = document.getElementById('empty-fav-msg');

    if (!grid) return; 

    grid.querySelectorAll('.service-item').forEach(el => el.remove());

    appState.cardsData.forEach(card => {
        const isFav = (appState.favorites || []).includes(card.id);
        const a = document.createElement('a');
        a.className = 'service-item';
        a.setAttribute('href', card.href || '#');
        a.setAttribute('data-id', card.id);
        a.setAttribute('data-cat', card.cat || 'work');

        if (card.live) a.setAttribute('data-live', 'true');
        if (card.href && card.href.startsWith('http')) {
            a.setAttribute('rel', 'noopener noreferrer');
        }
        if (card.onclickAttr) {
            a.setAttribute('onclick', card.onclickAttr);
        }
        a.setAttribute('style', `--c1:${card.c1}; --c2:${card.c2}; --c-rgb:${card.cRgb};`);

        const showFavBadge = isAdmin || isFav;
        const favInteractive = isAdmin ? 'interactive' : '';
        const topBarHTML = `
            ${card.live ? '<span class="live-pill">Live</span>' : '<span class="dot-placeholder"></span>'}
            ${showFavBadge ? 
                `<div class="fav-badge ${isFav ? 'is-fav' : ''} ${favInteractive}" onclick="toggleFav(event, '${card.id}')">
                    <i class="fa-solid fa-star"></i>
                </div>` : 
                `<div style="width:24px;"></div>`
            }
        `;

        a.innerHTML = `
            <div class="card-top-bar">${topBarHTML}</div>
            <div class="icon-circle"><i class="${card.icon}"></i></div>
            <div class="card-text">
                <div class="card-title">${card.title}</div>
                <div class="card-sub">${card.sub}</div>
            </div>
            <div class="card-admin-bar" onclick="event.preventDefault(); event.stopPropagation();">
                <button class="card-ctrl-btn" title="Move Back" onclick="moveCardInCurrentView('${card.id}', -1)"><i class="fa-solid fa-chevron-left"></i></button>
                <button class="card-ctrl-btn" title="Edit Card" onclick="openCardModal('${card.id}')"><i class="fa-solid fa-pen"></i></button>
                <button class="card-ctrl-btn danger" title="Move to Recycle Bin" onclick="removeCardToBin('${card.id}')"><i class="fa-solid fa-trash"></i></button>
                <button class="card-ctrl-btn" title="Move Forward" onclick="moveCardInCurrentView('${card.id}', 1)"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
        `;
        grid.insertBefore(a, emptyMsg);
    });

    updateAuthAndAdminUI();
    filterApps(currentFilter, document.getElementById('pill-' + currentFilter));
}

function filterApps(filterKey, pillEl) {
    currentFilter = filterKey;
    document.querySelectorAll('#filter-pills-container .pill').forEach(p => p.classList.remove('active'));
    const activePill = pillEl || document.getElementById('pill-' + filterKey);
    if (activePill) activePill.classList.add('active');

    const items = Array.from(document.querySelectorAll('#app-grid .service-item'));
    let visibleCount = 0;

    items.forEach(item => {
        const id = item.getAttribute('data-id');
        const cat = item.getAttribute('data-cat');
        const isLive = item.getAttribute('data-live'] === 'true';
        const isFav = (appState.favorites || []).includes(id);

        let show = false;
        if (filterKey === 'all') show = true;
        else if (filterKey === 'fav') show = isFav;
        else if (filterKey === 'live') show = isLive;
        else show = (cat === filterKey);

        item.style.display = show ? 'flex' : 'none';
        if (show) visibleCount++;
    });

    const emptyFavMsg = document.getElementById('empty-fav-msg');
    if (emptyFavMsg) {
        emptyFavMsg.style.display = (filterKey === 'fav' && visibleCount === 0) ? 'block' : 'none';
    }
}

function moveCardInCurrentView(cardId, direction) {
    const visibleIds = Array.from(document.querySelectorAll('#app-grid .service-item'))
        .filter(el => el.style.display !== 'none')
        .map(el => el.getAttribute('data-id'));

    const posInVisible = visibleIds.indexOf(cardId);
    const targetVisiblePos = posInVisible + direction;

    if (posInVisible === -1 || targetVisiblePos < 0 || targetVisiblePos >= visibleIds.length) return;

    const swapId = visibleIds[targetVisiblePos];
    const idxA = appState.cardsData.findIndex(c => c.id === cardId);
    const idxB = appState.cardsData.findIndex(c => c.id === swapId);

    if (idxA === -1 || idxB === -1) return;

    const temp = appState.cardsData[idxA];
    appState.cardsData[idxA] = appState.cardsData[idxB];
    appState.cardsData[idxB] = temp;

    if (currentFilter === 'fav') {
        const favA = appState.favorites.indexOf(cardId);
        const favB = appState.favorites.indexOf(swapId);
        if (favA !== -1 && favB !== -1) {
            const tFav = appState.favorites[favA];
            appState.favorites[favA] = appState.favorites[favB];
            appState.favorites[favB] = tFav;
        }
    }

    renderServiceGrid();
    pushStateToCloud(false);
}

function hexToRgbString(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`;
}

function openCardModal(cardId = '') {
    renderCategories();
    const modalTitle = document.getElementById('card-modal-title');
    document.getElementById('edit-card-id').value = cardId;

    if (cardId) {
        const card = appState.cardsData.find(c => c.id === cardId);
        if (!card) return;
        modalTitle.innerText = 'Edit Service Card';
        document.getElementById('card-title-input').value = card.title;
        document.getElementById('card-sub-input').value = card.sub;
        document.getElementById('card-href-input').value = card.href;
        document.getElementById('card-cat-input').value = card.cat;
        document.getElementById('card-icon-input').value = card.icon;
        document.getElementById('card-c1-input').value = card.c1.startsWith('#') ? card.c1 : '#3ded97';
        document.getElementById('card-c2-input').value = card.c2.startsWith('#') ? card.c2 : '#06b6d4';
        document.getElementById('card-live-input').checked = !!card.live;
    } else {
        modalTitle.innerText = 'Add New Service Card';
        document.getElementById('card-title-input').value = '';
        document.getElementById('card-sub-input').value = '';
        document.getElementById('card-href-input').value = 'https://';
        document.getElementById('card-icon-input').value = 'fa-solid fa-layer-group';
        document.getElementById('card-c1-input').value = '#3ded97';
        document.getElementById('card-c2-input').value = '#06b6d4';
        document.getElementById('card-live-input').checked = false;
    }
    openModal('card-modal');
}

function saveServiceCard() {
    const editId = document.getElementById('edit-card-id').value;
    const title = document.getElementById('card-title-input').value.trim();
    const sub = document.getElementById('card-sub-input').value.trim();
    const href = document.getElementById('card-href-input').value.trim() || '#';
    const cat = document.getElementById('card-cat-input').value || 'work';
    const icon = document.getElementById('card-icon-input').value.trim() || 'fa-solid fa-cube';
    const c1 = document.getElementById('card-c1-input').value;
    const c2 = document.getElementById('card-c2-input').value;
    const live = document.getElementById('card-live-input').checked;

    if (!title) return alert('Card Title is required.');

    if (editId) {
        const idx = appState.cardsData.findIndex(c => c.id === editId);
        if (idx !== -1) {
            appState.cardsData[idx] = {
                ...appState.cardsData[idx],
                title, sub, href, cat, icon, c1, c2,
                cRgb: hexToRgbString(c1),
                live
            };
        }
    } else {
        const newId = 'app-custom-' + Date.now();
        appState.cardsData.push({
            id: newId,
            title, sub, href, cat, icon, c1, c2,
            cRgb: hexToRgbString(c1),
            live,
            onclickAttr: ''
        });
        if (currentFilter === 'fav') {
            appState.favorites.push(newId);
        }
    }

    closeModal('card-modal');
    renderServiceGrid();
    pushStateToCloud(false);
}

function removeCardToBin(cardId) {
    const idx = appState.cardsData.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const [removed] = appState.cardsData.splice(idx, 1);
    removed.deletedAt = new Date().toLocaleString();
    appState.recycleBin = appState.recycleBin || [];
    appState.recycleBin.unshift(removed);

    renderServiceGrid();
    pushStateToCloud(false);
}

function openRecycleBinModal() {
    const list = document.getElementById('recycle-bin-list');
    const bin = appState.recycleBin || [];
    if (bin.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-secondary); font-size:13px;">Recycle Bin is empty.</div>`;
    } else {
        list.innerHTML = bin.map(item => `
            <div class="bin-item">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div class="icon-circle" style="width:36px; height:36px; font-size:14px; margin:0; --c1:${item.c1}; --c2:${item.c2};">
                        <i class="${item.icon}"></i>
                    </div>
                    <div>
                        <div style="font-size:13px; font-weight:700;">${item.title}</div>
                        <div style="font-size:10.5px; color:var(--text-secondary);">${item.sub} • ${item.deletedAt || ''}</div>
                    </div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="btn-action" style="padding:6px 10px; font-size:11px;" onclick="restoreFromBin('${item.id}')">
                        <i class="fa-solid fa-rotate-left"></i> Restore
                    </button>
                    <button class="btn-action btn-danger" style="padding:6px 10px; font-size:11px;" onclick="deletePermanentlyFromBin('${item.id}')">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }
    openModal('recycle-bin-modal');
}

function restoreFromBin(cardId) {
    const idx = (appState.recycleBin || []).findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const [restored] = appState.recycleBin.splice(idx, 1);
    delete restored.deletedAt;
    appState.cardsData.push(restored);
    renderServiceGrid();
    openRecycleBinModal();
    pushStateToCloud(false);
}

function deletePermanentlyFromBin(cardId) {
    appState.recycleBin = (appState.recycleBin || []).filter(c => c.id !== cardId);
    appState.favorites = (appState.favorites || []).filter(id => id !== cardId);
    updateAuthAndAdminUI();
    openRecycleBinModal();
    pushStateToCloud(false);
}

function emptyRecycleBin() {
    if (!appState.recycleBin || appState.recycleBin.length === 0) return;
    if (!confirm('Permanently empty all items in the Cloud Recycle Bin?')) return;
    appState.recycleBin = [];
    updateAuthAndAdminUI();
    openRecycleBinModal();
    pushStateToCloud(false);
}

// ----- UI Core Behaviors & Smart Routing -----
function goHomeWithFav() {
    const homePage = document.getElementById('page-home');
    if (!homePage) {
        window.location.href = 'index.html';
        return;
    }
    switchPage('home');
    const favPill = document.getElementById('pill-fav');
    if (typeof filterApps === 'function') {
        filterApps('fav', favPill);
    }
}

function switchPage(pageId) {
    const targetPage = document.getElementById('page-' + pageId);

    if (!targetPage) {
        window.location.href = 'index.html#' + pageId;
        return;
    }

    document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
    targetPage.classList.add('active');

    document.querySelectorAll('.bottom-nav .nav-item').forEach(b => b.classList.remove('active'));
    const navBtn = document.getElementById('nav-' + pageId);
    if (navBtn) navBtn.classList.add('active');

    const noticeRow = document.getElementById('home-notice-showcase');
    if (noticeRow) {
        noticeRow.style.display = (pageId === 'home') ? 'flex' : 'none';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleFav(e, cardId) {
    e.preventDefault();
    e.stopPropagation();
    if (!isAdmin) {
        showSyncToast('⚠️ Only Admins can modify Favourites.');
        return;
    }
    const idx = appState.favorites.indexOf(cardId);
    if (idx === -1) appState.favorites.push(cardId);
    else appState.favorites.splice(idx, 1);
    renderServiceGrid();
    pushStateToCloud(false);
}

// ----- Advanced Notice Board -----
function renderNotices() {
    const notices = appState.notices || [];
    const listEl = document.getElementById('notices-list');
    const countPill = document.getElementById('notice-count-pill');

    if (countPill) countPill.innerText = `${notices.length} / 30`;

    if (listEl) {
        if (notices.length === 0) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-secondary); font-size:12.5px;">No active notices posted yet.</div>`;
        } else {
            listEl.innerHTML = notices.map((n, idx) => {
                const isUrgent = n.priority === 'urgent';
                return `
                    <div class="attractive-notice-card ${isUrgent ? 'urgent' : ''}" id="notice-card-${idx}">
                        <div class="attractive-notice-header">
                            <div class="notice-badges-group">
                                <span class="notice-rank-pill ${isUrgent ? 'urgent' : ''}">
                                    <i class="fa-solid ${isUrgent ? 'fa-triangle-exclamation' : 'fa-bolt'}"></i> ${isUrgent ? 'Urgent' : 'Notice #' + (idx + 1)}
                                </span>
                                <span class="admin-posted-badge"><i class="fa-solid fa-shield-halved"></i> Admin</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span class="notice-time-badge"><i class="fa-regular fa-clock"></i> ${n.time || 'Live'}</span>
                                ${isAdmin ? `
                                    <button class="card-ctrl-btn" onclick="editNoticePrompt(${idx})" title="Edit Notice"><i class="fa-solid fa-pen"></i></button>
                                    <button class="card-ctrl-btn danger" onclick="deleteNotice(${idx})" title="Delete Notice"><i class="fa-solid fa-trash"></i></button>
                                ` : ''}
                            </div>
                        </div>
                        <div class="attractive-notice-text" id="notice-text-${idx}">${n.text}</div>
                        <button class="notice-expand-btn" id="notice-exp-btn-${idx}" style="display: none;" onclick="toggleNoticeExpand(${idx})">Expand</button>
                    </div>
                `;
            }).join('');

            setTimeout(() => {
                notices.forEach((_, idx) => {
                    const txtEl = document.getElementById(`notice-text-${idx}`);
                    const btnEl = document.getElementById(`notice-exp-btn-${idx}`);
                    if (txtEl && btnEl) {
                        if (txtEl.scrollHeight > txtEl.clientHeight || txtEl.innerText.length > 120) {
                            btnEl.style.display = 'inline-block';
                        }
                    }
                });
            }, 50);
        }
    }
    updateHomeNoticeShowcase();
}

function toggleNoticeExpand(idx) {
    const txtEl = document.getElementById(`notice-text-${idx}`);
    const btnEl = document.getElementById(`notice-exp-btn-${idx}`);
    if (!txtEl || !btnEl) return;
    const isExpanded = txtEl.classList.toggle('expanded');
    btnEl.innerText = isExpanded ? 'Collapse' : 'Expand';
}

function updateHomeNoticeShowcase() {
    const notices = appState.notices || [];
    const showcaseText = document.getElementById('home-notice-text');
    const showcaseBanner = document.getElementById('home-notice-showcase');
    if (!showcaseText || !showcaseBanner) return;

    if (notices.length === 0) {
        showcaseText.innerText = 'No global announcements right now.';
        showcaseBanner.classList.remove('urgent');
        return;
    }
    const item = notices[0];
    const isUrgent = item.priority === 'urgent';
    showcaseBanner.classList.toggle('urgent', isUrgent);
    showcaseText.innerText = item.text;

    showcaseText.style.animation = 'none';
    setTimeout(() => { showcaseText.style.animation = 'marquee 16s linear infinite'; }, 10);
}

function saveNoticeItem() {
    const input = document.getElementById('notice-input');
    const prioritySel = document.getElementById('notice-priority-input');
    const editIdxInput = document.getElementById('edit-notice-idx');
    const text = input.value.trim();
    const priority = prioritySel.value;
    if (!text) return;

    appState.notices = appState.notices || [];
    const editIdx = editIdxInput.value !== '' ? Number(editIdxInput.value) : -1;

    if (editIdx >= 0 && editIdx < appState.notices.length) {
        appState.notices[editIdx].text = text;
        appState.notices[editIdx].priority = priority;
        appState.notices[editIdx].time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + new Date().toLocaleDateString() + ' (Edited)';
    } else {
        appState.notices.unshift({
            text,
            priority,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + new Date().toLocaleDateString()
        });
        if (appState.notices.length > 30) appState.notices = appState.notices.slice(0, 30);
    }
    input.value = '';
    editIdxInput.value = '';
    document.getElementById('notice-btn-text').innerText = 'Publish Notice';
    renderNotices();
    pushStateToCloud(true);
}

function editNoticePrompt(idx) {
    const item = appState.notices[idx];
    if (!item) return;
    document.getElementById('notice-input').value = item.text;
    document.getElementById('notice-priority-input').value = item.priority || 'normal';
    document.getElementById('edit-notice-idx').value = idx;
    document.getElementById('notice-btn-text').innerText = 'Update Notice';
    switchPage('notices');
    document.getElementById('notice-input').focus();
}

function deleteNotice(idx) {
    appState.notices.splice(idx, 1);
    renderNotices();
    pushStateToCloud(false);
}

function clearAllNotices() {
    if (!confirm('Clear all global notices for all users?')) return;
    appState.notices = [];
    renderNotices();
    pushStateToCloud(true);
}

// ----- Admin Authentication & Actions -----
function openAdminModal() {
    document.getElementById('admin-pin-input').value = '';
    openModal('admin-modal');
}

function verifyAdminPin() {
    const entered = document.getElementById('admin-pin-input').value.trim();
    if (entered === appState.adminPin) {
        isAdmin = true;
        localStorage.setItem('kuafi_admin_unlocked', 'true');
        closeModal('admin-modal');
        renderCategories();
        renderServiceGrid();
        renderNotices();
        updateAuthAndAdminUI();
        showSyncToast('✓ Admin Mode Unlocked Successfully!');
    } else {
        alert('Invalid Admin PIN!');
    }
}

function logoutAdmin() {
    isAdmin = false;
    isRearrangeMode = false;
    isPreviewMode = false;
    localStorage.removeItem('kuafi_admin_unlocked');

    document.body.classList.remove('is-admin');
    document.body.classList.remove('rearrange-active');

    const rBanner = document.getElementById('rearrange-banner');
    if (rBanner) rBanner.classList.remove('active');
    const pBanner = document.getElementById('preview-banner');
    if (pBanner) pBanner.classList.remove('active');

    renderCategories();
    renderServiceGrid();
    renderNotices();
    updateAuthAndAdminUI();
    showSyncToast('🔓 Logged out from Admin');
    goHomeWithFav();
}

function handleSettingsCardClick() { switchPage('tools'); }

function toggleRearrangeMode(forceState) {
    isRearrangeMode = typeof forceState === 'boolean' ? forceState : !isRearrangeMode;
    document.body.classList.toggle('rearrange-active', isRearrangeMode);
    document.getElementById('rearrange-banner').classList.toggle('active', isRearrangeMode);
    if (isRearrangeMode) {
        document.getElementById('preview-banner').classList.remove('active');
        isPreviewMode = false;
    }
}

function saveRearrangeAndSync() {
    isRearrangeMode = false;
    document.body.classList.remove('rearrange-active');
    document.getElementById('rearrange-banner').classList.remove('active');
    pushStateToCloud(true);
}

function savePreviewAndSync() {
    isPreviewMode = false;
    document.getElementById('preview-banner').classList.remove('active');
    pushStateToCloud(true);
}

function openRearrangeFromTools() {
    switchPage('home');
    toggleRearrangeMode(true);
}

// ----- Grid Customizer Logic (15 Options Support) -----
function previewAndSaveGridCustomizer() {
    const cols = document.getElementById('grid-cols-select').value;
    const style = document.getElementById('grid-style-select').value;
    const layout = document.getElementById('grid-layout-select').value;

    appState.gridCols = parseInt(cols, 10) || 3;
    appState.gridStyleChoice = style;
    appState.gridLayoutChoice = layout;

    document.documentElement.style.setProperty('--grid-cols', appState.gridCols);
    applyCardGridStyleVars(style);
    applyCardGridLayoutVars(layout);

    isPreviewMode = true;
    isRearrangeMode = false;

    document.body.classList.remove('rearrange-active');
    document.getElementById('rearrange-banner').classList.remove('active');
    document.getElementById('preview-banner').classList.add('active');

    goHomeWithFav();
    showSyncToast('👁️ Live Preview Active! Tap "Apply to Cloud" to Save.');
}

function applyCardGridStyleVars(styleKey) {
    const isLight = document.body.classList.contains('light-mode');
    let radius = '18px';
    let border = '1px solid var(--border-color)';
    let bg = 'var(--card-bg)';
    let shadow = isLight ? '0 10px 25px rgba(15, 23, 42, 0.08), inset 0 1px 0px rgba(255, 255, 255, 1)' : '0 12px 32px -8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255, 255, 255, 0.06)';
    let gap = '12px';
    let padding = '12px 8px 14px';

    switch (String(styleKey)) {
        case '1': radius = '20px'; border = '1px solid var(--border-color)'; break;
        case '2': radius = '16px'; border = '1.5px solid var(--accent)'; shadow = '0 0 15px rgba(61,237,151,0.25)'; break;
        case '3': radius = '28px'; border = '1px solid var(--border-color)'; break;
        case '4': radius = '16px'; border = '2px solid transparent'; bg = 'linear-gradient(var(--card-bg), var(--card-bg)) padding-box, linear-gradient(135deg, var(--accent), var(--accent-secondary)) border-box'; break;
        case '5': radius = '10px'; border = '1px solid var(--border-color)'; shadow = 'none'; break;
        case '6': radius = '20px'; border = '1px solid var(--border-color)'; shadow = '0 16px 36px -10px rgba(0,0,0,0.25)'; break;
        case '7': radius = '12px'; border = '1.5px solid var(--text-secondary)'; break;
        case '8': radius = '4px'; border = '1px dashed var(--accent)'; break;
        case '9': radius = '22px'; border = '1px solid var(--border-color)'; break;
        case '10': radius = '18px'; border = '1px solid var(--border-color)'; bg = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(30,41,59,0.85)'; break;
        case '11': radius = '14px'; border = '2px solid var(--text-primary)'; break;
        case '12': radius = '16px'; border = '1px solid var(--border-color)'; bg = 'transparent'; shadow = 'none'; break;
        case '13': radius = '36px'; border = '1px solid var(--border-color)'; break;
        case '14': radius = '24px'; border = '1px solid var(--border-color)'; bg = isLight ? '#f8fafc' : '#121929'; break;
        case '15': radius = '8px'; border = '1px solid var(--border-color)'; shadow = 'none'; break;
    }

    document.documentElement.style.setProperty('--card-radius', radius);
    document.documentElement.style.setProperty('--card-border', border);
    document.documentElement.style.setProperty('--card-bg', bg);
    document.documentElement.style.setProperty('--card-shadow', shadow);
    document.documentElement.style.setProperty('--grid-gap', gap);
    document.documentElement.style.setProperty('--card-padding', padding);
}

function applyCardGridLayoutVars(layoutKey) {
    let align = 'center';
    let padding = '12px 8px 14px';
    let gap = '12px';

    switch (String(layoutKey)) {
        case '1': align = 'center'; padding = '12px 8px 14px'; gap = '12px'; break;
        case '2': align = 'center'; padding = '8px 6px 10px'; gap = '8px'; break;
        case '3': align = 'center'; padding = '18px 14px 20px'; gap = '16px'; break;
        case '4': align = 'center'; padding = '14px 10px 16px'; gap = '10px'; break;
        case '5': align = 'flex-start'; padding = '14px 12px 16px'; gap = '12px'; break;
        case '6': align = 'center'; padding = '14px 10px 16px'; gap = '12px'; break;
        case '7': align = 'center'; padding = '15px 12px 18px'; gap = '14px'; break;
        case '8': align = 'center'; padding = '18px 12px 20px'; gap = '10px'; break;
        case '9': align = 'flex-start'; padding = '10px 10px 12px'; gap = '10px'; break;
        case '10': align = 'center'; padding = '12px 10px 14px'; gap = '12px'; break;
        case '11': align = 'center'; padding = '14px 10px 16px'; gap = '10px'; break;
        case '12': align = 'center'; padding = '10px 8px 12px'; gap = '10px'; break;
        case '13': align = 'center'; padding = '16px 12px 18px'; gap = '14px'; break;
        case '14': align = 'flex-start'; padding = '12px 10px 14px'; gap = '10px'; break;
        case '15': align = 'center'; padding = '10px 10px 10px'; gap = '12px'; break;
    }

    document.documentElement.style.setProperty('--card-align', align);
    document.documentElement.style.setProperty('--card-padding', padding);
    document.documentElement.style.setProperty('--grid-gap', gap);
}

// ----- User Profile Logic -----
function openProfileModal() {
    const email = auth.currentUser?.email || 'default';
    const customProfile = JSON.parse(localStorage.getItem(`kuafi_user_profile_${email}`) || '{}');

    const emailInput = document.getElementById('profile-email-input');
    const nameInput = document.getElementById('profile-name-input');
    const phoneInput = document.getElementById('profile-phone-input');
    const addressInput = document.getElementById('profile-address-input');
    const districtInput = document.getElementById('profile-district-input');

    if(emailInput) emailInput.value = auth.currentUser?.email || 'Not available';
    if(nameInput) nameInput.value = customProfile.name || auth.currentUser?.displayName || '';
    if(phoneInput) phoneInput.value = customProfile.phone || '';
    if(addressInput) addressInput.value = customProfile.address || '';
    if(districtInput) districtInput.value = customProfile.district || '';

    openModal('user-profile-modal');
}

function saveUserProfileDetails() {
    const email = auth.currentUser?.email || 'default';
    const name = document.getElementById('profile-name-input')?.value.trim() || '';
    const phone = document.getElementById('profile-phone-input')?.value.trim() || '';
    const address = document.getElementById('profile-address-input')?.value.trim() || '';
    const district = document.getElementById('profile-district-input')?.value.trim() || '';

    const profileData = { name, phone, address, district };
    localStorage.setItem(`kuafi_user_profile_${email}`, JSON.stringify(profileData));

    const userNameEl = document.getElementById('google-user-name');
    if (userNameEl && name) {
        userNameEl.innerText = name;
    }

    const previewEl = document.getElementById('profile-details-preview');
    if (previewEl) {
        previewEl.innerText = `${name || 'User'} • ${phone || 'No phone'} • ${district || 'No district'}`;
    }

    closeModal('user-profile-modal');
    showSyncToast('✓ Profile details saved successfully!');
}

function setAccent(primary, secondary, el) {
    appState.accentPrimary = primary;
    appState.accentSecondary = secondary;
    document.documentElement.style.setProperty('--accent', primary);
    document.documentElement.style.setProperty('--accent-secondary', secondary);
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    if (el) el.classList.add('active');
    pushStateToCloud(false);
}

// ----- Reset & Utility Actions -----
function changeAdminPin() {
    const nextPin = prompt('Enter new Admin PIN:', appState.adminPin);
    if (nextPin && nextPin.trim()) {
        appState.adminPin = nextPin.trim();
        pushStateToCloud(true);
    }
}

function resetCardOrder() {
    if (!confirm('Restore original default cards and order?')) return;
    appState.cardsData = JSON.parse(JSON.stringify(INITIAL_20_CARDS));
    renderServiceGrid();
    pushStateToCloud(true);
}

function clearFavorites() {
    appState.favorites = [];
    renderServiceGrid();
    pushStateToCloud(true);
    showSyncToast('✓ Favourites reset successfully!');
}

function clearNotes() {
    appState.scratchpad = '';
    const notesEl = document.getElementById('quick-notes');
    if(notesEl) notesEl.value = '';
    pushStateToCloud(true);
}

function openUserNotesModal() {
    const email = auth.currentUser?.email || 'guest';
    const savedNotes = localStorage.getItem(`kuafi_user_notes_${email}`) || '';
    const notesArea = document.getElementById('user-private-notes-textarea');
    if(notesArea) notesArea.value = savedNotes;
    openModal('user-notes-modal');
}

function saveUserPrivateNotes() {
    const email = auth.currentUser?.email || 'guest';
    const notes = document.getElementById('user-private-notes-textarea')?.value || '';
    localStorage.setItem(`kuafi_user_notes_${email}`, notes);
    closeModal('user-notes-modal');
    showSyncToast('✓ Private notes saved locally!');
}

function exportGlobalBackup() {
    const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kuafi_global_system_backup_${Date.now()}.json`;
    a.click();
    showSyncToast('✓ Global system state exported!');
}

// ----- Utilities -----
function toggleHeaderSearch() {
    const c = document.getElementById('header-search-container');
    if (c) {
        c.classList.toggle('open');
        if (c.classList.contains('open')) {
            const input = document.getElementById('search-input');
            if (input) input.focus();
        }
    }
}

function handleSearch(query) {
    const q = query.trim().toLowerCase();
    document.querySelectorAll('#app-grid .service-item').forEach(item => {
        const t = item.querySelector('.card-title')?.innerText.toLowerCase() || '';
        const s = item.querySelector('.card-sub')?.innerText.toLowerCase() || '';
        item.style.display = (t.includes(q) || s.includes(q)) ? 'flex' : 'none';
    });
}

function openSafeUrl(url) { window.open(url, '_blank', 'noopener,noreferrer'); }
function copyPageUrl() { navigator.clipboard?.writeText(window.location.href); alert('Hub Link copied to clipboard!'); }

// ----- Cloud Push & Fetch -----
async function pushStateToCloud(showAlert = false) {
    isPushing = true;
    const notesEl = document.getElementById('quick-notes');
    if (notesEl) appState.scratchpad = notesEl.value;

    appState.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    pulseSyncBadge('Saving...');

    let syncedOk = false;

    if (hubDocRef) {
        try {
            await setDoc(hubDocRef, appState, { merge: true });
            syncedOk = true;
        } catch (e) {}
    }

    try {
        const res = await fetch(FIREBASE_RTDB_REST_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appState)
        });
        if (res.ok) syncedOk = true;
    } catch (e) {}

    isPushing = false;
    pulseSyncBadge('Live');

    const pill = document.getElementById('cloud-status-pill');
    if (pill) pill.innerText = syncedOk ? 'Synced to Cloud ✓' : 'Saved Locally';
    if (showAlert) showSyncToast('✓ Successfully Synced to Cloud for all users!');
}

async function syncData(manual = false) {
    const icon = document.getElementById('sync-icon');
    if (manual && icon) icon.classList.add('fa-spin');
    pulseSyncBadge('Sync');

    let latestCloudData = null;

    if (hubDocRef) {
        try {
            const snap = await getDoc(hubDocRef);
            if (snap.exists()) latestCloudData = snap.data();
        } catch (e) {}
    }

    try {
        const res = await fetch(FIREBASE_RTDB_REST_URL, { cache: 'no-store' });
        if (res.ok) {
            const rtdbData = await res.json();
            if (rtdbData && typeof rtdbData === 'object') {
                const rtdbTime = Number(rtdbData.updatedAt || 0);
                const fsTime = Number(latestCloudData?.updatedAt || 0);
                if (rtdbTime > fsTime) latestCloudData = rtdbData;
            }
        }
    } catch (e) {}

    if (latestCloudData) applyCloudStateToUI(latestCloudData, manual);

    setTimeout(() => {
        if (manual && icon) icon.classList.remove('fa-spin');
        pulseSyncBadge('Live');
    }, 350);
}

// ----- Modals Toggles -----
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ==========================================
// EXPORT FUNCTIONS TO GLOBAL WINDOW
// ==========================================
Object.assign(window, {
    toggleHeaderSearch, handleSearch, switchPage, toggleRearrangeMode,
    saveRearrangeAndSync, savePreviewAndSync, openCardModal,
    openCategoryModal, openRecycleBinModal, filterApps, toggleFav,
    handleSettingsCardClick, syncData, goHomeWithFav, saveNoticeItem,
    editNoticePrompt, deleteNotice, clearAllNotices, toggleNoticeExpand,
    loginWithGoogle, logoutGoogle, openAdminModal, verifyAdminPin,
    logoutAdmin, toggleTheme, setAccessMode, previewAndSaveGridCustomizer,
    openRearrangeFromTools, setAccent, changeAdminPin, openSafeUrl,
    copyPageUrl, pushStateToCloud, resetCardOrder, clearFavorites,
    clearNotes, openUserNotesModal, saveUserPrivateNotes, exportGlobalBackup,
    openProfileModal, saveUserProfileDetails, closeModal, saveServiceCard,
    removeCardToBin, restoreFromBin, deletePermanentlyFromBin, emptyRecycleBin,
    moveCategory, editCategoryPrompt, deleteCategory, saveCategoryItem,
    resetDefaultCategories, moveCardInCurrentView
});

// Run application
initApp();
