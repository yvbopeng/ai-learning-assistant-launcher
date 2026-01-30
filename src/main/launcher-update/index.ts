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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'fs';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';

import packageJson from '../../../package.json';
const currentVersion = packageJson.version;

// 在 Electron 中使用 original-fs 处理 asar 打包后的文件操作
// original-fs 是 Electron 内置模块，API 与 Node.js fs 模块相同
// 使用类型注解确保类型安全
// eslint-disable-next-line @typescript-eslint/no-var-requires
const originalFs: typeof import('fs') = require('original-fs');

// 更新日志文件路径
const updateLogPath = path.join(appPath, 'launcher-update.log');

/**
 * 写入更新日志到文件
 * @param level 日志级别
 * @param message 日志消息
 * @param data 附加数据
 */
function writeUpdateLog(
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
    appendFileSync(updateLogPath, logLine, { encoding: 'utf8' });
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
function initUpdateLog() {
  const separator = `
${'='.repeat(60)}
[${new Date().toISOString()}] 启动器更新日志开始
${'='.repeat(60)}
`;
  try {
    appendFileSync(updateLogPath, separator, { encoding: 'utf8' });
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
  initUpdateLog();
  writeUpdateLog('INFO', '[checkLauncherUpdate] 开始检查启动器更新');

  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const latestVersion = latestVersionInfo.version;
    const haveNew = semver.lt(currentVersion, latestVersion);

    writeUpdateLog('INFO', '[checkLauncherUpdate] 检查启动器更新完成', {
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
    writeUpdateLog(
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
  writeUpdateLog('INFO', '[downloadLauncherUpdate] 开始下载启动器更新');

  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );

    writeUpdateLog('DEBUG', '[downloadLauncherUpdate] 获取到最新版本信息', {
      version: latestVersionInfo.version,
      magnet: latestVersionInfo.dlcInfo?.magnet?.substring(0, 50) + '...',
    });

    await startWebtorrent(latestVersionInfo.dlcInfo.magnet);
    writeUpdateLog('DEBUG', '[downloadLauncherUpdate] WebTorrent 已启动');

    const torrent = await waitTorrentDone(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      latestVersionInfo.version,
    );

    const filePath = path.join(torrent.path, torrent.files[0].name);
    writeUpdateLog('INFO', '[downloadLauncherUpdate] 启动器更新下载完成', {
      path: torrent.path,
      fileName: torrent.files[0].name,
    });

    // 检查是否为本地开发环境
    const isDev = !app.isPackaged;
    if (isDev) {
      writeUpdateLog(
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
    writeUpdateLog(
      'ERROR',
      '[downloadLauncherUpdate] 下载启动器更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    throw error;
  }
}

export async function installLauncherUpdate() {
  writeUpdateLog('INFO', '[installLauncherUpdate] 开始执行安装更新');

  // 如果是开发模式，不执行更新
  const isPackaged = app.isPackaged;
  if (!isPackaged) {
    writeUpdateLog('WARN', '[installLauncherUpdate] 开发模式下不支持自动更新');
    return {
      success: false,
      message: '开发模式下不支持自动更新，请手动解压',
    };
  }

  try {
    writeUpdateLog('DEBUG', '[installLauncherUpdate] 获取最新版本信息...');
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const version = latestVersionInfo.version;
    writeUpdateLog('DEBUG', '[installLauncherUpdate] 最新版本:', version);

    const downloadPath = path.join(
      appPath,
      'external-resources',
      'dlc',
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      version,
    );
    writeUpdateLog('DEBUG', '[installLauncherUpdate] 下载路径:', downloadPath);
    writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 下载路径是否存在:',
      existsSync(downloadPath),
    );

    const files = readdirSync(downloadPath);
    writeUpdateLog('DEBUG', '[installLauncherUpdate] 下载目录文件列表:', files);
    const zipFile = files.find((f) => f.endsWith('.zip'));

    if (!zipFile) {
      writeUpdateLog('ERROR', '[installLauncherUpdate] 未找到下载的更新包');
      throw new Error('未找到下载的更新包');
    }

    // 销毁 WebTorrent 以释放文件句柄，避免后续读取 zip 文件时出现 EBUSY 错误
    writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 销毁 WebTorrent 释放文件句柄...',
    );
    await destroyWebtorrentForInstall(latestVersionInfo.dlcInfo.magnet);
    // 等待文件句柄完全释放
    await new Promise((resolve) => setTimeout(resolve, 1000));
    writeUpdateLog('DEBUG', '[installLauncherUpdate] 文件句柄已释放');

    const zipPath = path.join(downloadPath, zipFile);
    writeUpdateLog('DEBUG', '[installLauncherUpdate] zip文件路径:', zipPath);
    writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] zip文件是否存在:',
      existsSync(zipPath),
    );

    const tempDir = path.join(appPath, 'update-temp');
    writeUpdateLog('DEBUG', '[installLauncherUpdate] 临时目录:', tempDir);
    if (existsSync(tempDir)) {
      writeUpdateLog(
        'DEBUG',
        '[installLauncherUpdate] 清理已存在的临时目录...',
      );
      rmSync(tempDir, { recursive: true, force: true });
      writeUpdateLog('DEBUG', '[installLauncherUpdate] 临时目录清理完成');
    }
    mkdirSync(tempDir, { recursive: true });
    writeUpdateLog('DEBUG', '[installLauncherUpdate] 临时目录已创建');

    // 使用 adm-zip 解压 zip 文件
    writeUpdateLog('INFO', '[installLauncherUpdate] 正在解压文件...');
    writeUpdateLog('DEBUG', '[installLauncherUpdate] ZIP路径:', zipPath);
    writeUpdateLog('DEBUG', '[installLauncherUpdate] 目标路径:', tempDir);

    try {
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      writeUpdateLog(
        'DEBUG',
        '[installLauncherUpdate] ZIP包含的文件数量:',
        zipEntries.length,
      );
      writeUpdateLog(
        'DEBUG',
        '[installLauncherUpdate] ZIP包含的文件列表:',
        zipEntries.slice(0, 5).map((e) => e.entryName),
      );

      // 手动解压每个文件，使用 original-fs 避免 asar 打包问题和 Windows 下的 chmod 问题
      for (const entry of zipEntries) {
        const entryPath = path.join(tempDir, entry.entryName);
        if (entry.isDirectory) {
          // 创建目录
          if (!originalFs.existsSync(entryPath)) {
            originalFs.mkdirSync(entryPath, { recursive: true });
          }
        } else {
          // 确保父目录存在
          const parentDir = path.dirname(entryPath);
          if (!originalFs.existsSync(parentDir)) {
            originalFs.mkdirSync(parentDir, { recursive: true });
          }
          // 写入文件
          const content = entry.getData();
          originalFs.writeFileSync(entryPath, content);
        }
      }
      writeUpdateLog('INFO', '[installLauncherUpdate] 解压完成');
    } catch (extractError) {
      writeUpdateLog(
        'ERROR',
        '[installLauncherUpdate] 解压失败',
        extractError instanceof Error
          ? { message: extractError.message, stack: extractError.stack }
          : extractError,
      );
      throw extractError;
    }

    // 查找解压后的目录（通常会有一个子目录）
    const extractedItems = readdirSync(tempDir);
    writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 解压后的文件数量:',
      extractedItems.length,
    );
    writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 解压后的文件列表:',
      extractedItems,
    );

    let sourceDir = tempDir;
    if (extractedItems.length === 1) {
      const subPath = path.join(tempDir, extractedItems[0]);
      const subStat = statSync(subPath);
      writeUpdateLog('DEBUG', '[installLauncherUpdate] 检查子路径:', subPath);
      writeUpdateLog(
        'DEBUG',
        '[installLauncherUpdate] 是否为目录:',
        subStat.isDirectory(),
      );
      if (subStat.isDirectory()) {
        sourceDir = subPath;
        const subItems = readdirSync(sourceDir);
        writeUpdateLog(
          'DEBUG',
          '[installLauncherUpdate] 子目录文件列表:',
          subItems,
        );
      }
    }

    writeUpdateLog('DEBUG', '[installLauncherUpdate] 解压源目录:', sourceDir);

    const findExe = (dir: string): string | null => {
      const items = readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          const result = findExe(fullPath);
          if (result) return result;
        } else if (
          item.endsWith('.exe') &&
          item.includes('AI-Learning-Assistant-Launcher')
        ) {
          return fullPath;
        }
      }
      return null;
    };

    const newExePath = findExe(sourceDir);

    if (!newExePath) {
      writeUpdateLog(
        'ERROR',
        '[installLauncherUpdate] 未在更新包中找到启动器可执行文件',
      );
      throw new Error('未在更新包中找到启动器可执行文件');
    }

    writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 找到新版本可执行文件:',
      newExePath,
    );

    const currentExePath = app.getPath('exe');
    const currentExeDir = path.dirname(currentExePath);
    const currentExeName = path.basename(currentExePath);

    const backupPath = path.join(currentExeDir, `${currentExeName}.old`);

    // 找到新版本可执行文件所在目录的所有文件
    const newExeDir = path.dirname(newExePath);
    writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 新版本文件目录:',
      newExeDir,
    );
    writeUpdateLog('INFO', '[installLauncherUpdate] 更新路径信息', {
      currentExePath,
      currentExeDir,
      backupPath,
      newExeDir,
    });

    const result = await dialog.showMessageBox({
      type: 'info',
      title: '准备更新',
      message: '启动器将在关闭后自动更新',
      detail: `当前版本: ${currentVersion}\n新版本: ${version}\n\n点击"确定"后程序将关闭并自动更新，更新完成后会自动重启。`,
      buttons: ['确定', '取消'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      writeUpdateLog(
        'INFO',
        '[installLauncherUpdate] 用户确认更新，准备执行更新',
      );

      // 创建更新脚本，在应用退出后执行
      const updateScriptPath = path.join(appPath, 'update.bat');
      // bat 脚本也写入日志文件，方便追踪更新过程（Windows BAT 脚本路径不需要转义）
      const batLogPath = updateLogPath;
      const updateScript = `@echo off
chcp 65001
echo ===================================
echo 正在更新启动器...
echo ===================================

REM 写入日志函数
set "LOG_FILE=${batLogPath}"
echo [%date% %time%] [BAT] 更新脚本开始执行 >> "%LOG_FILE%"

REM 等待应用完全退出并释放文件句柄
echo 等待应用退出...
echo [%date% %time%] [BAT] 等待应用退出... >> "%LOG_FILE%"
timeout /t 3 /nobreak >nul

REM 删除旧备份
if exist "${backupPath}" (
    echo 删除旧备份...
    echo [%date% %time%] [BAT] 删除旧备份: ${backupPath} >> "%LOG_FILE%"
    del /f /q "${backupPath}"
)

REM 备份当前版本的可执行文件
if exist "${currentExePath}" (
    echo 备份当前版本...
    echo [%date% %time%] [BAT] 备份当前版本: ${currentExePath} -^> ${backupPath} >> "%LOG_FILE%"
    move /y "${currentExePath}" "${backupPath}"
    if errorlevel 1 (
        echo 备份失败！
        echo [%date% %time%] [BAT] [ERROR] 备份失败！ >> "%LOG_FILE%"
        pause
        exit /b 1
    )
    echo [%date% %time%] [BAT] 备份成功 >> "%LOG_FILE%"
)

REM 使用 robocopy 复制新版本的所有文件到当前目录
echo 正在复制文件...
echo [%date% %time%] [BAT] 开始复制文件: ${newExeDir} -^> ${currentExeDir} >> "%LOG_FILE%"
robocopy "${newExeDir}" "${currentExeDir}" /E /IS /IT /NFL /NDL /NP

REM robocopy 返回值说明：
REM 0 = 没有文件被复制
REM 1 = 所有文件复制成功
REM 2 = 有额外的文件或目录
REM 3 = 有文件被复制，也有不匹配的文件
REM 4 = 有不匹配的文件或目录
REM 5 = 有文件被复制，也有不匹配的文件或目录
REM 6 = 有额外的文件/目录和不匹配的文件
REM 7 = 文件被复制，有额外的文件和不匹配的文件
REM 8+ = 有错误

if %ERRORLEVEL% GEQ 8 (
    echo ===================================
    echo 复制文件失败！错误码: %ERRORLEVEL%
    echo 正在恢复原版本...
    echo ===================================
    echo [%date% %time%] [BAT] [ERROR] 复制文件失败！错误码: %ERRORLEVEL% >> "%LOG_FILE%"
    if exist "${backupPath}" (
        move /y "${backupPath}" "${currentExePath}"
        echo [%date% %time%] [BAT] 已恢复原版本 >> "%LOG_FILE%"
    )
    echo 更新失败，已恢复原版本
    pause
    exit /b 1
)

echo 文件复制完成，错误码: %ERRORLEVEL%
echo [%date% %time%] [BAT] 文件复制完成，错误码: %ERRORLEVEL% >> "%LOG_FILE%"

REM 清理临时文件
echo 清理临时文件...
echo [%date% %time%] [BAT] 清理临时文件: ${tempDir} >> "%LOG_FILE%"
if exist "${tempDir}" (
    rmdir /s /q "${tempDir}" 2>nul
)
echo [%date% %time%] [BAT] 临时文件清理完成 >> "%LOG_FILE%"

REM 启动新版本
echo ===================================
echo 启动新版本...
echo ===================================
echo [%date% %time%] [BAT] 启动新版本: ${currentExePath} >> "%LOG_FILE%"
start "" "${currentExePath}"

REM 等待一下确保应用启动
timeout /t 2 /nobreak >nul
echo [%date% %time%] [BAT] 更新脚本执行完成 >> "%LOG_FILE%"

REM 删除更新脚本自身
(goto) 2>nul & del "%~f0"
`;

      writeFileSync(updateScriptPath, updateScript, { encoding: 'utf8' });
      writeUpdateLog(
        'INFO',
        '[installLauncherUpdate] 更新脚本已创建:',
        updateScriptPath,
      );

      // 使用 detached 模式启动更新脚本
      const updateProcess = spawn('cmd.exe', ['/c', updateScriptPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });

      updateProcess.unref();
      writeUpdateLog('INFO', '[installLauncherUpdate] 更新脚本已启动');

      // 延迟退出，确保更新脚本已经启动
      // 注意：这里不使用 app.relaunch()，而是让更新脚本完成后手动启动新版本
      setTimeout(() => {
        writeUpdateLog('INFO', '[installLauncherUpdate] 准备退出应用');
        app.exit(0);
      }, 1000);

      return {
        success: true,
        message: '正在更新启动器...',
      };
    } else {
      writeUpdateLog('INFO', '[installLauncherUpdate] 用户取消更新');
      return {
        success: false,
        message: '用户取消更新',
      };
    }
  } catch (error) {
    writeUpdateLog(
      'ERROR',
      '[installLauncherUpdate] 安装启动器更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    throw error;
  }
}
