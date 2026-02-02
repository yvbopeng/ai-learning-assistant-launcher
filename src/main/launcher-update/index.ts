import { IpcMain, app, dialog } from 'electron';
import { ipcHandle } from '../ipc-util';
import {
  checkLauncherUpdateHandle,
  downloadLauncherUpdateHandle,
  installLauncherUpdateHandle,
} from './type-info';
import {
  getLatestVersion,
  startWebtorrent,
  waitTorrentDone,
  destroyWebtorrentForInstall,
} from '../dlc';
import semver from 'semver';
import path from 'path';
import { appPath } from '../exec';
import { existsSync, mkdirSync } from 'fs';
import {
  readdir,
  writeFile,
  appendFile,
  access,
  rename,
  constants,
} from 'fs/promises';
import { spawn } from 'child_process';

import packageJson from '../../../package.json';
const currentVersion = packageJson.version;

// 更新日志文件路径
const updateLogPath = path.join(appPath, 'launcher-update.log');

/**
 * 写入更新日志到文件
 * @param level 日志级别
 * @param message 日志消息
 * @param data 附加数据
 */
async function writeUpdateLog(
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  data?: unknown,
) {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] [${level}] ${message}`;
  if (data !== undefined) {
    try {
      logLine += ` ${JSON.stringify(data)}`;
    } catch {
      logLine += ` [无法序列化的数据]`;
    }
  }
  logLine += '\n';

  try {
    await appendFile(updateLogPath, logLine, { encoding: 'utf8' });
  } catch (err) {
    console.error('写入更新日志失败:', err);
  }

  // 同时输出到控制台
  switch (level) {
    case 'DEBUG':
      console.debug(message, data ?? '');
      break;
    case 'INFO':
      console.log(message, data ?? '');
      break;
    case 'WARN':
      console.warn(message, data ?? '');
      break;
    case 'ERROR':
      console.error(message, data ?? '');
      break;
  }
}

/**
 * 初始化日志文件（清空旧日志或添加分隔符）
 */
async function initUpdateLog() {
  const separator = `
${'='.repeat(60)}
[${new Date().toISOString()}] 启动器更新日志开始
${'='.repeat(60)}
`;
  try {
    await appendFile(updateLogPath, separator, { encoding: 'utf8' });
  } catch {
    // 忽略错误
  }
}

export default async function init(ipcMain: IpcMain) {
  ipcHandle(ipcMain, checkLauncherUpdateHandle, async (_event) =>
    checkLauncherUpdate(),
  );
  ipcHandle(ipcMain, downloadLauncherUpdateHandle, async (_event) =>
    downloadLauncherUpdate(),
  );
  ipcHandle(ipcMain, installLauncherUpdateHandle, async (_event) =>
    installLauncherUpdate(),
  );
}

export async function checkLauncherUpdate() {
  await initUpdateLog();
  await writeUpdateLog('INFO', '[checkLauncherUpdate] 开始检查启动器更新');

  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const latestVersion = latestVersionInfo.version;
    const haveNew = semver.lt(currentVersion, latestVersion);

    await writeUpdateLog('INFO', '[checkLauncherUpdate] 检查启动器更新完成', {
      currentVersion,
      latestVersion,
      haveNew,
    });

    return {
      currentVersion,
      latestVersion,
      haveNew,
    };
  } catch (error) {
    await writeUpdateLog(
      'ERROR',
      '[checkLauncherUpdate] 检查启动器更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    return {
      currentVersion,
      latestVersion: currentVersion,
      haveNew: false,
    };
  }
}

export async function downloadLauncherUpdate() {
  await writeUpdateLog('INFO', '[downloadLauncherUpdate] 开始下载启动器更新');

  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );

    await writeUpdateLog(
      'DEBUG',
      '[downloadLauncherUpdate] 获取到最新版本信息',
      {
        version: latestVersionInfo.version,
        magnet: latestVersionInfo.dlcInfo?.magnet?.substring(0, 50) + '...',
      },
    );

    await startWebtorrent(latestVersionInfo.dlcInfo.magnet);
    await writeUpdateLog('DEBUG', '[downloadLauncherUpdate] WebTorrent 已启动');

    const torrent = await waitTorrentDone(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      latestVersionInfo.version,
    );

    const filePath = path.join(torrent.path, torrent.files[0].name);
    await writeUpdateLog(
      'INFO',
      '[downloadLauncherUpdate] 启动器更新下载完成',
      {
        path: torrent.path,
        fileName: torrent.files[0].name,
      },
    );

    // 检查是否为本地开发环境，请打包后测试
    const isDev = !app.isPackaged;
    if (isDev) {
      await writeUpdateLog(
        'WARN',
        '[downloadLauncherUpdate] 当前为本地开发环境，启动器更新功能可能无法正常工作',
      );
    }

    return {
      success: true,
      version: latestVersionInfo.version,
      filePath,
      isDev,
    };
  } catch (error) {
    await writeUpdateLog(
      'ERROR',
      '[downloadLauncherUpdate] 下载启动器更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    throw error;
  }
}

/**
 * 生成自定义更新批处理脚本
 * 脚本功能：等待应用退出、备份用户数据、解压更新包、替换文件、恢复数据、启动新版本
 */
async function generateUpdateScript(
  zipPath: string,
  appDir: string,
  tempDir: string,
  newVersion: string,
): Promise<string> {
  const scriptContent = `@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "ZIP_PATH=${zipPath.replace(/\//g, '\\')}"
set "APP_DIR=${appDir.replace(/\//g, '\\')}"
set "TEMP_DIR=${tempDir.replace(/\//g, '\\')}"
set "BACKUP_DIR=${tempDir.replace(/\//g, '\\')}\\external-resources-backup"
set "EXTRACT_DIR=${tempDir.replace(/\//g, '\\')}\\extracted"

echo [更新] 等待应用退出...
:waitloop
tasklist /FI "IMAGENAME eq AI Learning Assistant Launcher.exe" 2>NUL | find /I "AI Learning Assistant Launcher.exe" >NUL
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto waitloop
)

echo [更新] 应用已退出，开始更新...

:: 创建临时目录
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"
if not exist "%EXTRACT_DIR%" mkdir "%EXTRACT_DIR%"

:: 备份 external-resources
echo [更新] 备份用户数据...
if exist "%APP_DIR%\\external-resources" (
    xcopy "%APP_DIR%\\external-resources" "%BACKUP_DIR%\\" /E /I /H /Y /Q
)

:: 解压 ZIP 文件
echo [更新] 解压更新包...
powershell -Command "Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%EXTRACT_DIR%' -Force"

:: 查找解压后的目录（ZIP 内可能有一层目录）
for /d %%D in ("%EXTRACT_DIR%\\*") do set "SOURCE_DIR=%%D"
if not defined SOURCE_DIR set "SOURCE_DIR=%EXTRACT_DIR%"

:: 删除旧文件（保留 external-resources）
echo [更新] 清理旧版本...
for /d %%D in ("%APP_DIR%\\*") do (
    if /I not "%%~nxD"=="external-resources" rd /s /q "%%D" 2>nul
)
for %%F in ("%APP_DIR%\\*") do (
    del /f /q "%%F" 2>nul
)

:: 复制新文件
echo [更新] 安装新版本...
xcopy "%SOURCE_DIR%\\*" "%APP_DIR%\\" /E /I /H /Y /Q

:: 恢复 external-resources（合并）
echo [更新] 恢复用户数据...
if exist "%BACKUP_DIR%" (
    xcopy "%BACKUP_DIR%\\*" "%APP_DIR%\\external-resources\\" /E /I /H /Y /Q
)

:: 清理临时文件
echo [更新] 清理临时文件...
rd /s /q "%TEMP_DIR%" 2>nul

:: 启动新版本
echo [更新] 启动新版本...
start "" "%APP_DIR%\\AI Learning Assistant Launcher.exe"

exit
`;

  // 确保临时目录存在
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const scriptPath = path.join(tempDir, 'update.bat');
  await writeFile(scriptPath, scriptContent, { encoding: 'utf8' });

  await writeUpdateLog('INFO', '[generateUpdateScript] 更新脚本已生成', {
    scriptPath,
    zipPath,
    appDir,
    tempDir,
    newVersion,
  });

  return scriptPath;
}

/**
 * 等待文件句柄释放的重试配置
 */
const FILE_RELEASE_CONFIG = {
  MAX_RETRIES: 10,
  INITIAL_DELAY_MS: 200,
  MAX_DELAY_MS: 2000,
};

/**
 * 检测文件是否可访问（句柄已释放）
 * 通过尝试 rename 操作来验证文件是否被占用
 * @param filePath 文件路径
 * @returns 是否可访问
 */
async function isFileAccessible(filePath: string): Promise<boolean> {
  try {
    // 检查文件是否可读
    await access(filePath, constants.R_OK);

    // 尝试 rename 到自身（Windows 下被占用的文件无法 rename）
    // 这是检测文件句柄是否释放的可靠方法
    const tempPath = filePath + '.tmp_check';
    await rename(filePath, tempPath);
    await rename(tempPath, filePath);

    return true;
  } catch {
    return false;
  }
}

/**
 * 等待文件句柄释放，使用指数退避重试机制
 * @param filePath 文件路径
 * @returns 文件是否可访问
 */
async function waitForFileRelease(filePath: string): Promise<void> {
  let delay = FILE_RELEASE_CONFIG.INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= FILE_RELEASE_CONFIG.MAX_RETRIES; attempt++) {
    const accessible = await isFileAccessible(filePath);

    if (accessible) {
      await writeUpdateLog('DEBUG', '[waitForFileRelease] 文件句柄已释放', {
        filePath,
        attempt,
      });
      return;
    }

    await writeUpdateLog(
      'DEBUG',
      '[waitForFileRelease] 文件仍被占用，等待重试',
      {
        filePath,
        attempt,
        nextDelayMs: delay,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    // 指数退避，但不超过最大延迟
    delay = Math.min(delay * 2, FILE_RELEASE_CONFIG.MAX_DELAY_MS);
  }

  throw new Error(
    `文件句柄释放超时: ${filePath}，已重试 ${FILE_RELEASE_CONFIG.MAX_RETRIES} 次`,
  );
}

export async function installLauncherUpdate() {
  await writeUpdateLog('INFO', '[installLauncherUpdate] 开始执行自定义更新');

  // 如果是开发模式，不执行更新
  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    await writeUpdateLog(
      'WARN',
      '[installLauncherUpdate] 开发模式下不支持自动更新',
    );
    return {
      success: false,
      message: '开发模式下不支持自动更新',
    };
  }

  try {
    // 获取最新版本信息
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 获取最新版本信息...',
    );
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const version = latestVersionInfo.version;
    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 最新版本:', version);

    // 下载目录
    const downloadPath = path.join(
      appPath,
      'external-resources',
      'dlc',
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      version,
    );
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 下载路径:',
      downloadPath,
    );

    if (!existsSync(downloadPath)) {
      await writeUpdateLog('ERROR', '[installLauncherUpdate] 下载目录不存在');
      throw new Error('更新包未下载，请先下载更新包');
    }

    // 查找 ZIP 文件
    const files = await readdir(downloadPath);
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 下载目录文件列表:',
      files,
    );

    const zipFile = files.find((f) => f.endsWith('.zip'));
    if (!zipFile) {
      await writeUpdateLog(
        'ERROR',
        '[installLauncherUpdate] 未找到 .zip 更新包',
      );
      throw new Error('未找到 .zip 更新包');
    }

    const zipPath = path.join(downloadPath, zipFile);
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] ZIP 文件路径:',
      zipPath,
    );

    // 销毁 WebTorrent 以释放文件句柄
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 销毁 WebTorrent 释放文件句柄...',
    );
    await destroyWebtorrentForInstall(latestVersionInfo.dlcInfo.magnet);

    // 使用重试机制等待文件句柄释放
    await waitForFileRelease(zipPath);
    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 文件句柄已释放');

    // 获取应用目录和临时目录
    const exePath = app.getPath('exe');
    const appDir = path.dirname(exePath);
    const tempDir = path.join(app.getPath('temp'), 'launcher-update');

    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 应用目录:', appDir);
    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 临时目录:', tempDir);

    // 显示更新确认对话框
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '准备更新',
      message: '启动器将在关闭后自动更新',
      detail: `当前版本: ${currentVersion}\n新版本: ${version}\n\n点击"确定"后程序将关闭并自动更新，更新完成后会自动重启。`,
      buttons: ['确定', '取消'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response !== 0) {
      await writeUpdateLog('INFO', '[installLauncherUpdate] 用户取消更新');
      return {
        success: false,
        message: '用户取消更新',
      };
    }

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 用户确认更新，准备执行自定义更新',
    );

    // 生成更新脚本
    const scriptPath = await generateUpdateScript(
      zipPath,
      appDir,
      tempDir,
      version,
    );

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 启动更新脚本:',
      scriptPath,
    );

    // 启动更新脚本
    const updateProcess = spawn('cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    updateProcess.unref();

    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 更新脚本已启动，准备退出应用',
    );

    // 延迟退出应用
    setTimeout(() => {
      app.quit();
    }, 1000);

    return {
      success: true,
      message: '正在更新启动器...',
    };
  } catch (error) {
    await writeUpdateLog(
      'ERROR',
      '[installLauncherUpdate] 自定义更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    throw error;
  }
}
