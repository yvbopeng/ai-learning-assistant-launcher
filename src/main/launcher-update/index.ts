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
  readFileSync,
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
  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const latestVersion = latestVersionInfo.version;
    const haveNew = semver.lt(currentVersion, latestVersion);

    console.debug('检查启动器更新:', {
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
    console.error('检查启动器更新失败:', error);
    return {
      currentVersion,
      latestVersion: currentVersion,
      haveNew: false,
    };
  }
}

export async function downloadLauncherUpdate() {
  try {
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );

    console.debug('开始下载启动器更新:', latestVersionInfo);

    await startWebtorrent(latestVersionInfo.dlcInfo.magnet);

    const torrent = await waitTorrentDone(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      latestVersionInfo.version,
    );

    console.debug('启动器更新下载完成');

    // 检查是否为本地开发环境
    // const isDev = !app.isPackaged;
    // if (isDev) {
    //   console.warn('当前为本地开发环境，启动器更新功能可能无法正常工作');
    // }

    return {
      success: true,
      version: latestVersionInfo.version,
      filePath: path.join(torrent.path, torrent.files[0].name),
      // isDev,
    };
  } catch (error) {
    console.error('下载启动器更新失败:', error);
    throw error;
  }
}

export async function installLauncherUpdate() {
  console.debug('[installLauncherUpdate] 开始执行安装更新');

  // 如果是开发模式，不执行更新
  // const isPackaged = app.isPackaged;
  // if (!isPackaged) {
  //   return {
  //     success: false,
  //     message: '开发模式下不支持自动更新，请手动解压',
  //   };
  // }

  try {
    console.debug('[installLauncherUpdate] 获取最新版本信息...');
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const version = latestVersionInfo.version;
    console.debug('[installLauncherUpdate] 最新版本:', version);

    const downloadPath = path.join(
      appPath,
      'external-resources',
      'dlc',
      'AI_LEARNING_ASSISTANT_LAUNCHER',
      version,
    );
    console.debug('[installLauncherUpdate] 下载路径:', downloadPath);
    console.debug(
      '[installLauncherUpdate] 下载路径是否存在:',
      existsSync(downloadPath),
    );

    const files = readdirSync(downloadPath);
    console.debug('[installLauncherUpdate] 下载目录文件列表:', files);
    const zipFile = files.find((f) => f.endsWith('.zip'));

    if (!zipFile) {
      throw new Error('未找到下载的更新包');
    }

    // 销毁 WebTorrent 以释放文件句柄，避免后续读取 zip 文件时出现 EBUSY 错误
    console.debug('[installLauncherUpdate] 销毁 WebTorrent 释放文件句柄...');
    await destroyWebtorrentForInstall(latestVersionInfo.dlcInfo.magnet);
    // 等待文件句柄完全释放
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.debug('[installLauncherUpdate] 文件句柄已释放');

    const zipPath = path.join(downloadPath, zipFile);
    console.debug('[installLauncherUpdate] zip文件路径:', zipPath);
    console.debug(
      '[installLauncherUpdate] zip文件是否存在:',
      existsSync(zipPath),
    );

    const tempDir = path.join(appPath, 'update-temp');
    console.debug('[installLauncherUpdate] 临时目录:', tempDir);
    if (existsSync(tempDir)) {
      console.debug('[installLauncherUpdate] 清理已存在的临时目录...');
      rmSync(tempDir, { recursive: true, force: true });
      console.debug('[installLauncherUpdate] 临时目录清理完成');
    }
    mkdirSync(tempDir, { recursive: true });
    console.debug('[installLauncherUpdate] 临时目录已创建');

    // 使用 adm-zip 解压 zip 文件
    console.log('[installLauncherUpdate] 正在解压文件...');
    console.log('[installLauncherUpdate] ZIP路径:', zipPath);
    console.log('[installLauncherUpdate] 目标路径:', tempDir);

    try {
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      console.log(
        '[installLauncherUpdate] ZIP包含的文件数量:',
        zipEntries.length,
      );
      console.log(
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
      console.log('[installLauncherUpdate] 解压完成');
    } catch (extractError) {
      console.error('[installLauncherUpdate] 解压失败:', extractError);
      console.error(
        '[installLauncherUpdate] 解压错误堆栈:',
        extractError instanceof Error ? extractError.stack : '无堆栈信息',
      );
      throw extractError;
    }

    // 查找解压后的目录（通常会有一个子目录）
    const extractedItems = readdirSync(tempDir);
    console.log(
      '[installLauncherUpdate] 解压后的文件数量:',
      extractedItems.length,
    );
    console.log('[installLauncherUpdate] 解压后的文件列表:', extractedItems);

    let sourceDir = tempDir;
    if (extractedItems.length === 1) {
      const subPath = path.join(tempDir, extractedItems[0]);
      const subStat = statSync(subPath);
      console.log('[installLauncherUpdate] 检查子路径:', subPath);
      console.log('[installLauncherUpdate] 是否为目录:', subStat.isDirectory());
      if (subStat.isDirectory()) {
        sourceDir = subPath;
        const subItems = readdirSync(sourceDir);
        console.log('[installLauncherUpdate] 子目录文件列表:', subItems);
      }
    }

    console.log('[installLauncherUpdate] 解压源目录:', sourceDir);

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

    const newExePath = findExe(tempDir);

    if (!newExePath) {
      throw new Error('未在更新包中找到启动器可执行文件');
    }

    console.debug('找到新版本可执行文件:', newExePath);

    const currentExePath = app.getPath('exe');
    const currentExeDir = path.dirname(currentExePath);
    const currentExeName = path.basename(currentExePath);

    const backupPath = path.join(currentExeDir, `${currentExeName}.old`);

    const updateScriptPath = path.join(appPath, 'update.bat');
    const updateScript = `@echo off
chcp 65001
echo 正在更新启动器...
timeout /t 2 /nobreak >nul

REM 删除旧备份
if exist "${backupPath}" del /f /q "${backupPath}"

REM 备份当前版本
move /y "${currentExePath}" "${backupPath}"

REM 复制新版本
copy /y "${newExePath}" "${currentExePath}"

REM 清理临时文件
rmdir /s /q "${tempDir}"

REM 启动新版本
start "" "${currentExePath}"

REM 删除更新脚本自身
(goto) 2>nul & del "%~f0"
`;

    writeFileSync(updateScriptPath, updateScript, { encoding: 'utf8' });

    console.debug('更新脚本已创建:', updateScriptPath);

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
      spawn('cmd.exe', ['/c', updateScriptPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });

      setTimeout(() => {
        app.quit();
      }, 1000);

      return {
        success: true,
        message: '正在更新启动器...',
      };
    } else {
      return {
        success: false,
        message: '用户取消更新',
      };
    }
  } catch (error) {
    console.error('[installLauncherUpdate] 安装启动器更新失败:', error);
    console.error(
      '[installLauncherUpdate] 错误堆栈:',
      error instanceof Error ? error.stack : '无堆栈信息',
    );
    throw error;
  }
}
