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
import { existsSync } from 'fs';
import {
  readdir,
  writeFile,
  appendFile,
  readFile,
  stat,
  access,
  rename,
  constants,
} from 'fs/promises';
import { spawn } from 'child_process';
import { createHash } from 'crypto';

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

    // 检查是否为本地开发环境
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
 * 获取 Squirrel Update.exe 的路径
 * Squirrel 安装后，Update.exe 位于应用安装目录的上一级
 */
function getSquirrelUpdateExePath(): string | null {
  const exePath = app.getPath('exe');
  const exeDir = path.dirname(exePath);
  // Squirrel 安装结构: <install_root>/Update.exe, <install_root>/app-x.x.x/app.exe
  const updateExePath = path.join(exeDir, '..', 'Update.exe');

  if (existsSync(updateExePath)) {
    return path.resolve(updateExePath);
  }
  return null;
}

/**
 * 计算文件的 SHA1 哈希值
 */
async function calculateSha1(filePath: string): Promise<string> {
  const fileBuffer = await readFile(filePath);
  const hash = createHash('sha1');
  hash.update(fileBuffer);
  return hash.digest('hex').toUpperCase();
}

/**
 * 生成 Squirrel RELEASES 文件
 * RELEASES 文件格式: SHA1 filename size
 */
async function generateReleasesFile(
  nupkgPath: string,
  outputDir: string,
): Promise<string> {
  const fileName = path.basename(nupkgPath);
  const fileStat = await stat(nupkgPath);
  const fileSize = fileStat.size;
  const sha1Hash = await calculateSha1(nupkgPath);

  const releasesContent = `${sha1Hash} ${fileName} ${fileSize}`;
  const releasesPath = path.join(outputDir, 'RELEASES');

  await writeFile(releasesPath, releasesContent, { encoding: 'utf8' });
  await writeUpdateLog('INFO', '[generateReleasesFile] RELEASES 文件已生成', {
    path: releasesPath,
    content: releasesContent,
  });

  return releasesPath;
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
  await writeUpdateLog(
    'INFO',
    '[installLauncherUpdate] 开始执行 Squirrel 更新',
  );

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

  // 检查是否为 Squirrel 安装
  const updateExePath = getSquirrelUpdateExePath();
  if (!updateExePath) {
    await writeUpdateLog(
      'WARN',
      '[installLauncherUpdate] 未检测到 Squirrel 安装，无法使用 Squirrel 更新',
    );
    return {
      success: false,
      message: '当前安装方式不支持 Squirrel 自动更新，请手动下载安装包更新',
    };
  }

  await writeUpdateLog(
    'DEBUG',
    '[installLauncherUpdate] 检测到 Update.exe:',
    updateExePath,
  );

  try {
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 获取最新版本信息...',
    );
    const latestVersionInfo = getLatestVersion(
      'AI_LEARNING_ASSISTANT_LAUNCHER',
    );
    const version = latestVersionInfo.version;
    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 最新版本:', version);

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
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 下载路径是否存在:',
      existsSync(downloadPath),
    );

    if (!existsSync(downloadPath)) {
      await writeUpdateLog('ERROR', '[installLauncherUpdate] 下载目录不存在');
      throw new Error('更新包未下载，请先下载更新包');
    }

    const files = await readdir(downloadPath);
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 下载目录文件列表:',
      files,
    );

    // 查找 .nupkg 文件
    const nupkgFile = files.find((f) => f.endsWith('.nupkg'));
    if (!nupkgFile) {
      await writeUpdateLog(
        'ERROR',
        '[installLauncherUpdate] 未找到 .nupkg 更新包',
      );
      throw new Error('未找到 .nupkg 更新包');
    }

    const nupkgPath = path.join(downloadPath, nupkgFile);
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] nupkg 文件路径:',
      nupkgPath,
    );

    // 销毁 WebTorrent 以释放文件句柄
    await writeUpdateLog(
      'DEBUG',
      '[installLauncherUpdate] 销毁 WebTorrent 释放文件句柄...',
    );
    await destroyWebtorrentForInstall(latestVersionInfo.dlcInfo.magnet);

    // 使用重试机制等待文件句柄释放
    await waitForFileRelease(nupkgPath);
    await writeUpdateLog('DEBUG', '[installLauncherUpdate] 文件句柄已释放');

    // 生成 RELEASES 文件（Squirrel 需要此文件来确定更新信息）
    await writeUpdateLog(
      'INFO',
      '[installLauncherUpdate] 生成 RELEASES 文件...',
    );
    await generateReleasesFile(nupkgPath, downloadPath);

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

    if (result.response === 0) {
      await writeUpdateLog(
        'INFO',
        '[installLauncherUpdate] 用户确认更新，准备执行 Squirrel 更新',
      );

      // 使用 Squirrel 的 Update.exe 执行更新
      // 参数 --update=<path> 指定包含 RELEASES 和 .nupkg 的目录
      await writeUpdateLog(
        'INFO',
        '[installLauncherUpdate] 调用 Squirrel Update.exe',
        {
          updateExePath,
          updatePath: downloadPath,
        },
      );

      const updateProcess = spawn(updateExePath, ['--update', downloadPath], {
        detached: true,
        stdio: 'ignore',
      });

      updateProcess.unref();
      await writeUpdateLog(
        'INFO',
        '[installLauncherUpdate] Squirrel 更新进程已启动',
      );

      // 延迟退出应用，让 Squirrel 接管更新流程
      setTimeout(async () => {
        await writeUpdateLog('INFO', '[installLauncherUpdate] 准备退出应用');
        // Squirrel 会在更新完成后自动重启应用
        app.quit();
      }, 1500);

      return {
        success: true,
        message: '正在通过 Squirrel 更新启动器...',
      };
    } else {
      await writeUpdateLog('INFO', '[installLauncherUpdate] 用户取消更新');
      return {
        success: false,
        message: '用户取消更新',
      };
    }
  } catch (error) {
    await writeUpdateLog(
      'ERROR',
      '[installLauncherUpdate] Squirrel 更新失败',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
    throw error;
  }
}
