const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Prevent garbage collection of the window
let mainWindow;

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Majeng Life Core Admin",
    icon: path.join(__dirname, 'icon.ico'), // Make sure icon.ico exists in root
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Required for window.require in React
      enableRemoteModule: true
    }
  });

  // Load the app
  // In development, we load the Vite local server
  // In production (the .exe), we load the built index.html
  const isDev = !app.isPackaged;
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in dev mode for debugging
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // Remove the default menu bar for a cleaner "App" look
  mainWindow.setMenuBarVisibility(false);
}

// --- APP LIFECYCLE ---

app.whenReady().then(() => {
  createWindow();

  // Optional: Check for updates silently as soon as the app starts
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- AUTO UPDATE LOGIC ---

// 1. Listen for the "Check Update" button click from React (App.jsx)
ipcMain.on('check-for-update', () => {
  if (!app.isPackaged) {
    // In dev mode, we can't really update because there is no installer
    mainWindow.webContents.send('update-message', 'Dev Mode: Cannot update.');
    return;
  }
  // This triggers the check against your GitHub repo
  autoUpdater.checkForUpdates();
});

// 2. Listen for the "Restart" button click from React (App.jsx)
ipcMain.on('restart-app', () => {
  // This quits the app and launches the new installer silently
  autoUpdater.quitAndInstall();
});

// --- UPDATER EVENTS (Sending status back to React) ---

autoUpdater.on('checking-for-update', () => {
  if(mainWindow) mainWindow.webContents.send('update-message', 'Checking for updates...');
});

autoUpdater.on('update-available', () => {
  if(mainWindow) mainWindow.webContents.send('update-message', 'Update found! Downloading...');
});

autoUpdater.on('update-not-available', () => {
  if(mainWindow) mainWindow.webContents.send('update-message', 'You are on the latest version.');
});

autoUpdater.on('error', (err) => {
  if(mainWindow) mainWindow.webContents.send('update-message', 'Error: ' + (err.message || "Unknown"));
});

autoUpdater.on('download-progress', (progressObj) => {
  const logMessage = `Downloading ${Math.round(progressObj.percent)}%`;
  if(mainWindow) mainWindow.webContents.send('update-message', logMessage);
});

autoUpdater.on('update-downloaded', () => {
  // 1. Tell React to show the "Restart to Update" button
  if(mainWindow) mainWindow.webContents.send('update-downloaded');
  // 2. Update the status text
  if(mainWindow) mainWindow.webContents.send('update-message', 'Download complete.');
});