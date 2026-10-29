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
const STORAGE_KEY_ACTIVE = 'magical_pdf_active_id_v1';
const STORAGE_KEY_LIST = 'magical_pdf_saved_library_v1';
const STORAGE_KEY_ZOOM = 'magical_pdf_saved_zoom_v1';
const THEME_STORAGE_KEY = 'kuafi_theme_mode';

let isAdmin = false;
let isGoogleLoggedIn = false;

onAuthStateChanged(auth, (user) => {
    if (user && user.email && ADMIN_GOOGLE_EMAILS.includes(user.email.toLowerCase())) {
        isAdmin = true;
    }
    if (isAdmin) {
        document.body.classList.add('is-admin');
    }
});

// ================= HEADER SYNC LOGIC =================
// Sync notice board text from Firestore
if (hubDocRef) {
    onSnapshot(hubDocRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            if (data.notices && data.notices.length > 0) {
                const latestNotice = data.notices[0];
                const noticeTextEl = document.getElementById('home-notice-text');
                if (noticeTextEl) {
                    noticeTextEl.innerText = latestNotice.text;
                    
                    // Restart marquee animation to prevent clipping when text changes
                    noticeTextEl.style.display = 'none';
                    noticeTextEl.offsetHeight; // trigger reflow
                    noticeTextEl.style.display = 'inline-block';
                }
            }
            
            // Pulse the live indicator
            const dot = document.getElementById('live-sync-dot');
            if (dot) {
                dot.classList.add('polling');
                setTimeout(() => dot.classList.remove('polling'), 600);
            }
        }
    });
}

window.toggleHeaderSearch = function() {
    const c = document.getElementById('header-search-container');
    if (c) {
        c.classList.toggle('open');
        if (c.classList.contains('open')) {
            const input = document.getElementById('search-input');
            if(input) input.focus();
        }
    }
};

window.handleSearch = function(query) {
    console.log("Global search triggered with:", query);
    // Search functionality could be implemented here if you wish
};

// ================= ASYNC COMPONENT LOADER =================
async function loadComponents() {
    try {
        // Load Header
        const headerRes = await fetch('header.html');
        if (headerRes.ok) {
            const headerHtml = await headerRes.text();
            const headerPlaceholder = document.getElementById('header-placeholder');
            if (headerPlaceholder) {
                headerPlaceholder.outerHTML = headerHtml;
            }
        }
    } catch (e) {
        console.error('Failed to load header:', e);
    }

    try {
        // Load Footer
        const footerRes = await fetch('footer.html');
        if (footerRes.ok) {
            const footerHtml = await footerRes.text();
            const footerPlaceholder = document.getElementById('footer-placeholder');
            if (footerPlaceholder) {
                footerPlaceholder.outerHTML = footerHtml;
            }
        }
    } catch (e) {
        console.error('Failed to load footer:', e);
    }
}

// ================= PDF READER LOGIC =================
const DEFAULT_FILE_ID = '1iLYBo1YToYSTlSqt8cYDyIwOk0V9yZbt';

let pdfFrame, zoomStage, iframeWrapper, pdfCard, topToolbar, expandToolbarBtn, workspace, notesInput;

let currentRotation = 0;
let isInverted = false;
let savedLibrary = [];
let activeFileId = DEFAULT_FILE_ID;

// Smooth Zoom State
let currentZoom = 100;
let targetZoom = 100;
let zoomAnimFrame = null;

// Initialize PDF Viewer after components load
async function initPDFReader() {
    await loadComponents(); // Await external header & footer injection first

    pdfFrame = document.getElementById('pdfFrame');
    zoomStage = document.getElementById('zoomStage');
    iframeWrapper = document.getElementById('iframeWrapper');
    pdfCard = document.getElementById('pdfCard');
    topToolbar = document.getElementById('topToolbar');
    expandToolbarBtn = document.getElementById('expandToolbarBtn');
    workspace = document.getElementById('workspace');
    notesInput = document.getElementById('notesInput');

    const storedList = localStorage.getItem(STORAGE_KEY_LIST);
    if (storedList) {
        try {
            savedLibrary = JSON.parse(storedList);
        } catch (e) {
            savedLibrary = [];
        }
    }

    if (savedLibrary.length === 0) {
        savedLibrary = [{
            id: DEFAULT_FILE_ID,
            title: 'Primary Document',
            addedAt: new Date().toLocaleDateString()
        }];
        localStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(savedLibrary));
    }

    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('id');
    const storedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE);

    if (paramId) {
        const extracted = extractDriveId(paramId);
        if (extracted) {
            activeFileId = extracted;
            ensureInLibrary(activeFileId, 'Shared Document');
        }
    } else if (storedActiveId) {
        activeFileId = storedActiveId;
    } else {
        activeFileId = savedLibrary[0].id;
    }

    // Restore last saved zoom level if any
    const savedZoom = parseFloat(localStorage.getItem(STORAGE_KEY_ZOOM));
    if (!isNaN(savedZoom) && savedZoom >= 50 && savedZoom <= 250) {
        setZoomImmediate(savedZoom);
    } else {
        setZoomImmediate(100);
    }

    if (notesInput) {
        notesInput.value = localStorage.getItem('pdf_reader_notes') || '';
        notesInput.addEventListener('input', () => {
            localStorage.setItem('pdf_reader_notes', notesInput.value);
        });
    }

    loadPDFById(activeFileId, false);
    renderSavedLibrary();
}

window.addEventListener('DOMContentLoaded', initPDFReader);

// ================= SMOOTH 60FPS ZOOM ENGINE =================
window.stepZoom = function(delta) {
    const next = Math.min(250, Math.max(50, Math.round(targetZoom + delta)));
    animateZoomTo(next);
};

window.animateZoomTo = function(newTarget) {
    targetZoom = Math.min(250, Math.max(50, parseFloat(newTarget)));
    localStorage.setItem(STORAGE_KEY_ZOOM, targetZoom);

    if (zoomAnimFrame) cancelAnimationFrame(zoomAnimFrame);

    function tick() {
        const diff = targetZoom - currentZoom;
        if (Math.abs(diff) < 0.4) {
            currentZoom = targetZoom;
            applyZoomGeometry(currentZoom);
            zoomAnimFrame = null;
            return;
        }
        currentZoom += diff * 0.24; // Smooth spring interpolation
        applyZoomGeometry(currentZoom);
        zoomAnimFrame = requestAnimationFrame(tick);
    }

    zoomAnimFrame = requestAnimationFrame(tick);
};

window.setZoomImmediate = function(val) {
    if (zoomAnimFrame) cancelAnimationFrame(zoomAnimFrame);
    currentZoom = Math.min(250, Math.max(50, parseFloat(val)));
    targetZoom = currentZoom;
    localStorage.setItem(STORAGE_KEY_ZOOM, currentZoom);
    applyZoomGeometry(currentZoom);
};

function applyZoomGeometry(z) {
    const scale = z / 100;
    const rounded = Math.round(z);

    // Sync all UI badges and sliders safely
    const tb = document.getElementById('topZoomBadge');
    const db = document.getElementById('dockZoomBadge');
    const dzv = document.getElementById('drawerZoomVal');
    const hzr = document.getElementById('headerZoomReadout');
    const ts = document.getElementById('topZoomSlider');
    const ds = document.getElementById('drawerZoomSlider');

    if(tb) tb.innerText = rounded + '%';
    if(db) db.innerText = rounded + '%';
    if(dzv) dzv.innerText = rounded + '%';
    if(hzr) hzr.innerText = `Zoom: ${rounded}%`;
    if(ts) ts.value = rounded;
    if(ds) ds.value = rounded;

    if (!iframeWrapper || !zoomStage || !pdfFrame) return;

    // Record horizontal scroll ratio before resizing stage
    const maxScrollBefore = iframeWrapper.scrollWidth - iframeWrapper.clientWidth;
    const scrollRatio = maxScrollBefore > 0 ? (iframeWrapper.scrollLeft / maxScrollBefore) : 0.5;

    if (scale >= 1) {
        zoomStage.style.width = (scale * 100) + '%';
        zoomStage.style.height = '100%';

        pdfFrame.style.width = (100 / scale) + '%';
        pdfFrame.style.height = (100 / scale) + '%';
        pdfFrame.style.transformOrigin = '0 0';
        pdfFrame.style.transform = `scale(${scale})`;

        const maxScrollAfter = iframeWrapper.scrollWidth - iframeWrapper.clientWidth;
        if (maxScrollAfter > 0) {
            iframeWrapper.scrollLeft = maxScrollAfter * scrollRatio;
        }
    } else {
        zoomStage.style.width = '100%';
        zoomStage.style.height = '100%';

        pdfFrame.style.width = '100%';
        pdfFrame.style.height = (100 / scale) + '%';
        pdfFrame.style.transformOrigin = 'top center';
        pdfFrame.style.transform = `scale(${scale})`;
        iframeWrapper.scrollLeft = 0;
    }
}

// Keyboard shortcuts: Ctrl/Cmd + Plus, Minus, 0
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            window.stepZoom(15);
        } else if (e.key === '-') {
            e.preventDefault();
            window.stepZoom(-15);
        } else if (e.key === '0') {
            e.preventDefault();
            window.animateZoomTo(100);
        }
    }
});

window.toggleZoomDock = function() {
    const dock = document.getElementById('floatingZoomDock');
    if(dock) dock.classList.toggle('minimized');
};

// ================= PERMANENT DRIVE LINK MANAGER =================
function extractDriveId(input) {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{15,})/);
    if (fileMatch && fileMatch[1]) return fileMatch[1];

    const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
    if (idParamMatch && idParamMatch[1]) return idParamMatch[1];

    if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;

    return null;
}

window.saveQuickLink = function() {
    const inputEl = document.getElementById('quickUrlInput');
    if(!inputEl) return;
    const fileId = extractDriveId(inputEl.value);

    if (!fileId) {
        showToast('Please paste a valid PDF link!', true);
        return;
    }

    const title = `Document #${savedLibrary.length + 1}`;
    ensureInLibrary(fileId, title);
    loadPDFById(fileId, true);
    inputEl.value = '';
};

window.addAndSavePDF = function() {
    const titleEl = document.getElementById('pdfTitleInput');
    const urlEl = document.getElementById('pdfUrlInput');
    if(!urlEl) return;

    const fileId = extractDriveId(urlEl.value);
    if (!fileId) {
        showToast('Invalid PDF link!', true);
        return;
    }

    const title = (titleEl && titleEl.value.trim()) || `Saved PDF #${savedLibrary.length + 1}`;
    ensureInLibrary(fileId, title);
    loadPDFById(fileId, true);

    if(titleEl) titleEl.value = '';
    urlEl.value = '';
};

function ensureInLibrary(fileId, title) {
    const existingIndex = savedLibrary.findIndex(item => item.id === fileId);
    if (existingIndex > -1) {
        if (title && title !== 'Shared Document') {
            savedLibrary[existingIndex].title = title;
        }
    } else {
        savedLibrary.unshift({
            id: fileId,
            title: title,
            addedAt: new Date().toLocaleDateString()
        });
    }
    localStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(savedLibrary));
    renderSavedLibrary();
}

function loadPDFById(fileId, showNotification = true) {
    activeFileId = fileId;
    localStorage.setItem(STORAGE_KEY_ACTIVE, fileId);

    const item = savedLibrary.find(i => i.id === fileId);
    const docTitle = item ? item.title : 'Custom PDF';

    const loader = document.getElementById('loader');
    if(loader) loader.classList.remove('hidden');

    if(pdfFrame) {
        pdfFrame.src = `https://drive.google.com/file/d/${fileId}/preview`;
    }
    
    const dBtn = document.getElementById('downloadBtn');
    if(dBtn) {
        dBtn.href = `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    
    const dTitle = document.getElementById('docTitleDisplay');
    if(dTitle) {
        dTitle.innerText = docTitle;
    }
    
    document.title = `${docTitle} - PDF Studio Pro`;

    renderSavedLibrary();
    if (showNotification) {
        showToast(`"${docTitle}" loaded & saved permanently!`);
    }
}

function renderSavedLibrary() {
    const container = document.getElementById('savedListContainer');
    const countEl = document.getElementById('savedCount');
    if(!container) return;
    
    if(countEl) countEl.innerText = savedLibrary.length;
    container.innerHTML = '';

    savedLibrary.forEach(item => {
        const div = document.createElement('div');
        div.className = `saved-item ${item.id === activeFileId ? 'active' : ''}`;
        div.onclick = () => loadPDFById(item.id, true);

        div.innerHTML = `
            <div class="saved-item-info">
                <div class="saved-item-title">${escapeHtml(item.title)}</div>
                <div class="saved-item-id">ID: ${item.id.substring(0, 14)}... • ${item.addedAt}</div>
            </div>
            <div class="saved-item-actions">
                <button class="icon-btn" onclick="copyShareUrl(event, '${item.id}')" title="Copy Shareable Link">
                    <i class="fa-solid fa-share-nodes"></i>
                </button>
                ${savedLibrary.length > 1 ? `
                <button class="icon-btn delete" onclick="deleteSavedPDF(event, '${item.id}')" title="Remove from Saved">
                    <i class="fa-solid fa-trash"></i>
                </button>` : ''}
            </div>
        `;
        container.appendChild(div);
    });
}

window.deleteSavedPDF = function(event, fileId) {
    event.stopPropagation();
    savedLibrary = savedLibrary.filter(item => item.id !== fileId);
    localStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(savedLibrary));

    if (activeFileId === fileId && savedLibrary.length > 0) {
        loadPDFById(savedLibrary[0].id, false);
    }
    renderSavedLibrary();
    showToast('Removed from saved library');
};

window.copyShareUrl = function(event, fileId) {
    event.stopPropagation();
    const shareUrl = `${window.location.origin}${window.location.pathname}?id=${fileId}`;
    navigator.clipboard.writeText(shareUrl);
    showToast('Shareable direct link copied!');
};

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    if(!toast || !toastMsg) return;
    
    toast.style.background = isError ? '#ef4444' : '#10b981';
    toastMsg.innerText = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function escapeHtml(str) {
    if(!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// ================= VIEWER & FILTER CONTROLS =================
window.hideLoader = function() {
    const loader = document.getElementById('loader');
    if(loader) loader.classList.add('hidden');
};

window.toggleToolbar = function() {
    if(topToolbar) topToolbar.classList.toggle('collapsed');
    if(expandToolbarBtn) expandToolbarBtn.classList.toggle('visible');
};

window.toggleMinimizePDF = function() {
    if(!pdfCard) return;
    pdfCard.classList.toggle('minimized');
    const btn = document.getElementById('minimizeBtn');
    if(btn) {
        if (pdfCard.classList.contains('minimized')) {
            btn.innerHTML = '<i class="fa-solid fa-expand"></i> <span>Expand</span>';
            btn.classList.add('active');
        } else {
            btn.innerHTML = '<i class="fa-solid fa-compress"></i> <span>Collapse</span>';
            btn.classList.remove('active');
        }
    }
};

window.toggleEdgeToEdge = function() {
    if(!workspace) return;
    workspace.classList.toggle('edge-to-edge');
    const btn = document.getElementById('edgeBtn');
    if(btn) btn.classList.toggle('active');
};

window.rotatePDF = function() {
    if(!zoomStage) return;
    currentRotation = (currentRotation + 90) % 360;
    zoomStage.style.transform = `rotate(${currentRotation}deg)`;
};

window.toggleDrawer = function(drawerId) {
    const drawers = ['libraryDrawer', 'displayDrawer', 'notesDrawer'];
    drawers.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            if (id === drawerId) {
                el.classList.toggle('open');
            } else {
                el.classList.remove('open');
            }
        }
    });
};

window.updateWidth = function(val) {
    if(workspace) workspace.classList.remove('edge-to-edge');
    const edgeBtn = document.getElementById('edgeBtn');
    if(edgeBtn) edgeBtn.classList.remove('active');
    
    document.documentElement.style.setProperty('--viewer-width', val + '%');
    
    const wVal = document.getElementById('widthVal');
    const wSlider = document.getElementById('widthSlider');
    if(wVal) wVal.innerText = val + '%';
    if(wSlider) wSlider.value = val;
};

window.applyFilters = function() {
    const brightSlider = document.getElementById('brightSlider');
    const contrastSlider = document.getElementById('contrastSlider');
    const sepiaSlider = document.getElementById('sepiaSlider');
    
    if(!brightSlider || !contrastSlider || !sepiaSlider || !pdfFrame) return;

    const b = brightSlider.value;
    const c = contrastSlider.value;
    const s = sepiaSlider.value;

    const bv = document.getElementById('brightVal');
    const cv = document.getElementById('contrastVal');
    const sv = document.getElementById('sepiaVal');
    
    if(bv) bv.innerText = b + '%';
    if(cv) cv.innerText = c + '%';
    if(sv) sv.innerText = s + '%';

    const invertFilter = isInverted ? 'invert(0.9) hue-rotate(180deg)' : '';
    pdfFrame.style.filter = `brightness(${b}%) contrast(${c}%) sepia(${s}%) ${invertFilter}`;
};

window.toggleInvert = function() {
    isInverted = !isInverted;
    window.applyFilters();
};

window.resetFilters = function() {
    isInverted = false;
    currentRotation = 0;
    if(zoomStage) zoomStage.style.transform = 'rotate(0deg)';
    
    const brightSlider = document.getElementById('brightSlider');
    const contrastSlider = document.getElementById('contrastSlider');
    const sepiaSlider = document.getElementById('sepiaSlider');
    
    if(brightSlider) brightSlider.value = 100;
    if(contrastSlider) contrastSlider.value = 100;
    if(sepiaSlider) sepiaSlider.value = 0;
    
    window.updateWidth(94);
    window.animateZoomTo(100);
    window.applyFilters();
};

window.toggleFullScreen = function() {
    const icon = document.getElementById('fsIcon');
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        if(icon) icon.classList.replace('fa-expand', 'fa-compress');
    } else {
        document.exitFullscreen();
        if(icon) icon.classList.replace('fa-compress', 'fa-expand');
    }
};

window.downloadNotes = function() {
    if(!notesInput) return;
    const blob = new Blob([notesInput.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PDF-Reading-Notes.txt';
    a.click();
};

window.clearNotes = function() {
    if (confirm('Clear all saved notes?')) {
        if(notesInput) notesInput.value = '';
        localStorage.removeItem('pdf_reader_notes');
    }
};
