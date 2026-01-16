import { dialog, IpcMain, app } from 'electron';
import { ActionName, channel, ServiceName } from './type-info';
import { appPath, Exec } from '../exec';
import { isMac, isWindows, replaceVarInPath } from '../exec/util';
import {
  getObsidianConfig,
  setVaultDefaultOpen,
  getObsidianVaultConfig,
} from '../configs';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';
import path from 'node:path';
import {
  statSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';

import {
  getLatestVersion,
  startWebtorrent,
  waitTorrentDone,
  getActiveTorrents,
} from '../dlc';
import {
  ensurePodmanWorks,
  getPodmanCli,
  resetPodman,
  stopPodman,
  isPodmanInstall,
  isPodmanInit,
  getPodmanInfo,
} from '../podman-desktop/ensure-podman-works';
import { RunResult } from '@podman-desktop/api';
import { podMachineName } from '../podman-desktop/type-info';
import { isVTReady, isWSLInstall, wslVersion } from './is-wsl-install';
import { loggerFactory } from '../terminal-log';

const commandLine = new Exec();

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (
      event,
      action: ActionName,
      serviceName: ServiceName,
      vaultId?: string,
    ) => {
      console.debug(
        `cmd action: ${action}, serviceName: ${serviceName}, channel: ${channel}`,
      );
      if (isWindows()) {
        if (action === 'start') {
          if (serviceName === 'obsidianApp') {
            // Obsidian app specific command
            console.debug('obsidian app start', vaultId);
            if (vaultId) {
              setVaultDefaultOpen(vaultId);
            }
            let obsidianPath = getObsidianConfig().obsidianApp.bin;
            let vaultName = null;
            // 获取仓库路径
            if (vaultId) {
              const vaults = getObsidianVaultConfig();
              const vault = vaults.find((v) => v.id === vaultId);
              if (vault) {
                // 获取路径中的最后一个文件夹名称
                vaultName = path.basename(vault.path);
              }
            }
            try {
              obsidianPath = replaceVarInPath(obsidianPath);
              // 如果有仓库路径，则传递给Obsidian作为参数
              const args = vaultName
                ? [`obsidian://open/?vault=${encodeURIComponent(vaultName)}`]
                : [];
              const result = commandLine.exec(obsidianPath, args, {});
              // const result = commandLine.exec(obsidianPath, [], {});
              event.reply(channel, MESSAGE_TYPE.INFO, '成功启动obsidian');
            } catch (e) {
              console.warn('启动obsidian失败', e);
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                '启动obsidian失败，请检查obsidian路径设置',
              );
            }
          } else {
            const result = await commandLine.exec('echo %cd%');
            console.debug('cmd', result);
            event.reply(channel, MESSAGE_TYPE.INFO, '成功启动');
          }
        } else if (action === 'stop') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功停止');
        } else if (action === 'remove') {
          if (serviceName === 'podman') {
            try {
              await resetPodman();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, true),
              );
              event.reply(channel, MESSAGE_TYPE.INFO, '成功删除所有服务和缓存');
            } catch (e) {
              console.error(e);
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                '删除所有服务和缓存失败',
              );
            }
          } else {
            event.reply(channel, MESSAGE_TYPE.INFO, '成功删除');
          }
        } else if (action === 'install') {
          if (serviceName === 'WSL') {
            event.reply(
              channel,
              MESSAGE_TYPE.PROGRESS,
              '预计需要10分钟，请耐心等待',
            );
            let result: boolean;
            try {
              result = await installWSL();
            } catch (e) {
              console.error(e);
              event.reply(channel, MESSAGE_TYPE.ERROR, e && e.message);
              return;
            }
            const version = await wslVersion();
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, {
                version,
                installed: result,
              }),
            );
          } else if (serviceName === 'obsidianApp') {
            try {
              const result = await installObsidian();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, result),
              );
            } catch (e) {
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, false),
              );
            }
          } else if (serviceName === 'lm-studio') {
            try {
              const result = await installLMStudio(event);
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, result),
              );
              event.reply(channel, MESSAGE_TYPE.INFO, 'LM Studio安装成功');
            } catch (e) {
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                `LM Studio安装失败: ${e.message || '未知错误'}`,
              );
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, false),
              );
            }
          } else {
            const result = await commandLine.exec('echo %cd%');
            event.reply(channel, MESSAGE_TYPE.INFO, '安装成功');
          }
        } else if (action === 'query') {
          if (serviceName === 'WSL') {
            const vTReady = await isVTReady();
            const version = await wslVersion();
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, {
                version,
                vTReady,
                installed: await isWSLInstall(),
              }),
            );
          } else if (serviceName === 'obsidianApp') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, await isObsidianInstall()),
            );
          } else if (serviceName === 'lm-studio') {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, await isLMStudioInstall()),
            );
          } else if (serviceName === 'podman') {
            try {
              const podmanInstalled = await isPodmanInstall();
              const podmanInited = await isPodmanInit();
              const podmanInfo = await getPodmanInfo();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, {
                  podmanInfo,
                  installed: podmanInstalled && podmanInited,
                }),
              );
            } catch (e) {
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, {
                  installed: false,
                }),
              );
            }
          } else {
            const result = await commandLine.exec('echo %cd%');
            event.reply(channel, MESSAGE_TYPE.INFO, '成功查询');
          }
        } else if (action === 'move') {
          const dialogResult = await dialog.showOpenDialog({
            title: '请选择服务的安装位置',
            properties: ['openDirectory', 'showHiddenFiles'],
          });
          const path = dialogResult.filePaths[0];
          if (!path || path === '') {
            event.reply(channel, MESSAGE_TYPE.ERROR, '未选择正确的安装位置');
            return;
          }
          const specialChars = /[\s<>"|?*/\0]/;
          if (specialChars.test(path)) {
            event.reply(
              channel,
              MESSAGE_TYPE.ERROR,
              `您选择的路径是${path}，路径中包含空格等特殊字符，请删除特殊字符后重试`,
            );
            return;
          }
          try {
            await ensurePodmanWorks(event, channel);
            const result = await movePodman(path);
            if (result.success) {
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, true),
              );
              event.reply(channel, MESSAGE_TYPE.INFO, '成功修改安装位置');
            } else {
              event.reply(channel, MESSAGE_TYPE.ERROR, result.errorMessage);
            }
          } catch (e) {
            console.error(e);
          }
        } else if (action === 'update') {
          if (serviceName === 'WSL') {
            event.reply(
              channel,
              MESSAGE_TYPE.PROGRESS,
              '预计需要10分钟，请耐心等待',
            );
            let result: boolean;
            try {
              result = await installWSL();
            } catch (e) {
              console.error(e);
              event.reply(channel, MESSAGE_TYPE.ERROR, e && e.message);
              return;
            }
            const version = await wslVersion();
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, {
                version,
                installed: result,
              }),
            );
          } else if (serviceName === 'lm-studio') {
            // 更新LM Studio
            try {
              event.reply(
                channel,
                MESSAGE_TYPE.PROGRESS,
                '正在更新LM Studio...',
              );
              const result = await installLMStudio(event);
              const versionInfo = await checkLMStudioUpdate();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, {
                  installed: result,
                  ...versionInfo,
                }),
              );
              event.reply(channel, MESSAGE_TYPE.INFO, 'LM Studio更新成功');
            } catch (e) {
              console.error(e);
              event.reply(
                channel,
                MESSAGE_TYPE.ERROR,
                `LM Studio更新失败: ${e.message || '未知错误'}`,
              );
            }
          } else {
            const result = await commandLine.exec('echo %cd%');
            event.reply(channel, MESSAGE_TYPE.INFO, '成功更新');
          }
        } else if (action === 'checkVersion') {
          if (serviceName === 'lm-studio') {
            try {
              const versionInfo = await checkLMStudioUpdate();
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, versionInfo),
              );
            } catch (e) {
              console.error(e);
              event.reply(
                channel,
                MESSAGE_TYPE.DATA,
                new MessageData(action, serviceName, {
                  needUpdate: false,
                  installedVersion: null,
                  latestVersion: null,
                }),
              );
            }
          } else {
            event.reply(channel, MESSAGE_TYPE.ERROR, '不支持此服务的版本检查');
          }
        } else {
          event.reply(channel, MESSAGE_TYPE.ERROR, '现在还没有这个功能');
        }
      } else if (isMac()) {
        if (action === 'start') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功启动');
        } else if (action === 'stop') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功停止');
        } else if (action === 'remove') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功删除');
        } else if (action === 'install') {
          const result = await commandLine.exec('pwd');
          event.reply(channel, MESSAGE_TYPE.INFO, '安装成功');
        } else if (action === 'query') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功查询');
        } else if (action === 'update') {
          const result = await commandLine.exec('echo %cd%');
          event.reply(channel, MESSAGE_TYPE.INFO, '成功更新');
        } else {
          event.reply(channel, MESSAGE_TYPE.ERROR, '现在还没有这个功能');
        }
      } else {
        event.reply(channel, MESSAGE_TYPE.ERROR, '现在还不支持这个平台');
      }
    },
  );
}

export async function installWSL() {
  // WSL 安装需要windows update服务正常
  try {
    const outputStartWindowsUpdate = await commandLine.exec('net', [
      'start',
      'wuauserv',
    ]);
    console.debug('check windows update', outputStartWindowsUpdate);
  } catch (e) {
    console.error(e);
    if (e && e.message && e.message.indexOf('1058') >= 0) {
      throw new Error(
        '安装WSL失败，因为Windows系统更新未打开。请打开系统更新后重试。',
      );
    }
  }

  try {
    const outputWSLmsi = await commandLine.exec(
      path.join(
        appPath,
        'external-resources',
        'ai-assistant-backend',
        'install_wsl.msi',
      ),
      [],
    );

    console.debug('installWSLmsi', outputWSLmsi);
  } catch (e) {
    console.error(e);
    if (e.message.indexOf('exitCode: 1603') >= 0) {
      // 这个错误可能代表安装过了
    } else {
      return false;
    }
  }

  let successM1 = false;
  // 方法一，适用于windows11
  try {
    const resultM1 = await commandLine.exec(
      'wsl.exe',
      ['--install', '--no-distribution'],
      { shell: true, encoding: 'utf16le' },
    );
    console.debug('installWSLM1', resultM1);
    if (
      resultM1.stdout.indexOf('The operation completed successfully') >= 0 ||
      resultM1.stdout.indexOf('请求的操作成功') >= 0 ||
      resultM1.stdout.indexOf('操作成功完成') >= 0
    ) {
      successM1 = true;
    }
  } catch (e) {
    console.warn('installWSLM1', e);
    // 3010表示安装成功需要重启
    if (e.message && e.message.indexOf('3010') >= 0) {
      console.warn(e);
      successM1 = true;
    } else {
      console.error(e);
      successM1 = false;
    }
  }

  if (successM1) {
    return true;
  }

  //方法二，适用于windows10
  let success1 = false;
  try {
    const result1 = await commandLine.exec(
      'dism.exe',
      [
        '/online',
        '/enable-feature',
        '/featurename:Microsoft-Windows-Subsystem-Linux',
        '/all',
        '/norestart',
      ],
      { shell: true },
    );
    console.debug('installWSL', result1);
  } catch (e) {
    console.warn('installWSL', e);
    // 3010表示安装成功需要重启
    if (e.message && e.message.indexOf('3010') >= 0) {
      console.warn(e);
      success1 = true;
    } else {
      console.error(e);
      success1 = false;
    }
  }

  let success2 = false;
  try {
    const result2 = await commandLine.exec(
      'dism.exe',
      [
        '/online',
        '/enable-feature',
        '/featurename:VirtualMachinePlatform',
        '/all',
        '/norestart',
      ],
      { shell: true },
    );
  } catch (e) {
    console.warn('installWSL', e);
    // 3010表示安装成功需要重启
    if (e.message && e.message.indexOf('3010') >= 0) {
      console.warn(e);
      success2 = true;
    } else {
      console.error(e);
      success2 = false;
    }
  }
  return success1 && success2;
}

async function checkWSLComponent() {
  let virtualMachinePlatformInstalled = true;
  try {
    const output2 = await commandLine.exec(
      'dism.exe',
      ['/online', '/get-featureinfo', '/featurename:VirtualMachinePlatform'],
      {
        shell: true,
      },
    );
    console.debug('isWSLInstall', output2);
    if (output2.stdout.indexOf('已启用') >= 0) {
      virtualMachinePlatformInstalled = true;
    } else {
      virtualMachinePlatformInstalled = false;
    }
  } catch (e) {
    console.warn('isWSLInstall', e);
    virtualMachinePlatformInstalled = false;
  }

  let mWSLInstalled = true;
  try {
    const output2 = await commandLine.exec(
      'dism.exe',
      [
        '/online',
        '/get-featureinfo',
        '/featurename:Microsoft-Windows-Subsystem-Linux',
      ],
      {
        shell: true,
      },
    );
    console.debug('isWSLInstall', output2);
    if (output2.stdout.indexOf('已启用') >= 0) {
      mWSLInstalled = true;
    } else {
      mWSLInstalled = false;
    }
  } catch (e) {
    console.warn('isWSLInstall', e);
    mWSLInstalled = false;
  }

  console.debug(
    'WSL安装情况调试信息',
    'virtualMachinePlatformInstalled',
    virtualMachinePlatformInstalled,
    'mWSLInstalled',
    mWSLInstalled,
  );

  return virtualMachinePlatformInstalled && mWSLInstalled;
}

export async function installObsidian() {
  const result = await commandLine.exec(
    path.join(
      appPath,
      'external-resources',
      'ai-assistant-backend',
      'install_obsidian.exe',
    ),
    ['/s'],
  );
  console.debug(result);
  return true;
}

export async function isObsidianInstall() {
  let obsidianPath = getObsidianConfig().obsidianApp.bin;

  try {
    obsidianPath = replaceVarInPath(obsidianPath);
    console.debug('getObsidianConfig', obsidianPath);
    const stat = statSync(obsidianPath);
    if (stat.isFile()) {
      return true;
    } else {
      return false;
    }
  } catch (e) {
    console.warn('检查obsidian失败', e);
    return false;
  }
}

const LM_STUDIO_DLC_ID = 'LM_STUDIO_SETUP_EXE';

// 获取本地已安装的LM Studio版本
export async function getLMStudioInstalledVersion(): Promise<string | null> {
  try {
    const result = await Promise.race([
      new Promise<RunResult>((resolve, reject) =>
        setTimeout(() => reject('getLMStudioInstalledVersion命令超时'), 15000),
      ),
      commandLine.exec('lms', ['version']),
    ]);
    console.debug('getLMStudioInstalledVersion', result);
    // 解析版本号，通常格式为 "lms version x.x.x" 或 "x.x.x"
    const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
    return versionMatch ? versionMatch[1] : null;
  } catch (e) {
    console.warn('获取LM Studio版本失败', e);
    return null;
  }
}

// 比较版本号，返回 true 如果 v1 < v2
function isVersionOlder(v1: string, v2: string): boolean {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return true;
    if (p1 > p2) return false;
  }
  return false;
}

// 检查是否需要更新
export async function checkLMStudioUpdate(): Promise<{
  needUpdate: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
}> {
  const installedVersion = await getLMStudioInstalledVersion();
  // 无法通过网络获取最新版本，返回不需要更新
  const latestVersion = null;
  const needUpdate = false;

  return { needUpdate, installedVersion, latestVersion };
}

// 使用 WebTorrent 从 dlc-index.json 下载并安装 LM Studio
export async function installLMStudio(
  event?: Electron.IpcMainEvent,
): Promise<boolean> {
  try {
    // 从 dlc-index.json 获取最新版本信息
    console.debug('正在获取 LM Studio 版本信息...');
    if (event) {
      event.reply(
        channel,
        MESSAGE_TYPE.PROGRESS,
        '正在获取 LM Studio 版本信息...',
      );
    }

    const latestVersionInfo = getLatestVersion(LM_STUDIO_DLC_ID);

    const { version, dlcInfo } = latestVersionInfo;
    const magnet = dlcInfo.magnet;

    if (!magnet) {
      throw new Error('DLC 索引中没有 magnet 链接');
    }

    console.debug(`开始通过 WebTorrent 下载 LM Studio v${version}...`);
    if (event) {
      event.reply(
        channel,
        MESSAGE_TYPE.PROGRESS,
        `正在通过 P2P 下载 LM Studio v${version}...`,
      );
      event.reply(channel, MESSAGE_TYPE.DOWNLOAD_PROGRESS, {
        percent: 0,
        status: 'downloading',
        message: `正在通过 P2P 下载 LM Studio v${version}...`,
      });
    }

    // 启动 WebTorrent 下载
    await startWebtorrent(magnet);

    // 轮询下载进度并更新 UI
    const pollProgressInterval = setInterval(() => {
      const torrents = getActiveTorrents();
      const torrent = torrents.find((t) =>
        magnet.toLowerCase().includes(t.infoHash.toLowerCase()),
      );
      if (torrent && event) {
        const percent = Math.round(torrent.progress * 100);
        event.reply(channel, MESSAGE_TYPE.DOWNLOAD_PROGRESS, {
          percent,
          status: 'downloading',
          message: `正在下载 LM Studio: ${percent}% (${formatSpeed(torrent.downloadSpeed)})`,
        });
      }
    }, 1000);

    // 等待下载完成
    try {
      await waitTorrentDone(LM_STUDIO_DLC_ID, version);
    } finally {
      clearInterval(pollProgressInterval);
    }

    console.debug('WebTorrent 下载完成，开始安装...');
    if (event) {
      event.reply(channel, MESSAGE_TYPE.DOWNLOAD_PROGRESS, {
        percent: 100,
        status: 'installing',
        message: '下载完成，正在安装 LM Studio...',
      });
    }

    // 查找下载的安装文件
    const downloadPath = path.join(
      appPath,
      'external-resources',
      'dlc',
      LM_STUDIO_DLC_ID,
      version,
    );

    // 查找 .exe 文件
    const files = readdirSync(downloadPath);
    const exeFile = files.find(
      (f) => f.endsWith('.exe') && !f.endsWith('.torrent'),
    );

    if (!exeFile) {
      throw new Error('下载目录中找不到安装程序');
    }

    const installerPath = path.join(downloadPath, exeFile);
    console.debug('安装程序路径:', installerPath);

    // 运行安装程序（静默安装）
    const result = await commandLine.exec(installerPath, ['/s']);
    console.debug('安装结果', result);

    if (event) {
      event.reply(channel, MESSAGE_TYPE.DOWNLOAD_PROGRESS, {
        percent: 100,
        status: 'done',
        message: 'LM Studio 安装完成',
      });
    }

    return true;
  } catch (e) {
    console.error('安装 LM Studio 失败', e);
    throw e;
  }
}

// 格式化下载速度
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(0)} B/s`;
  } else if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  } else {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  }
}

export async function isLMStudioInstall() {
  try {
    const result = await Promise.race([
      new Promise<RunResult>((resolve, reject) =>
        setTimeout(() => reject('isLMStudioInstall命令超时'), 15000),
      ),
      // 如果用户安装lmstudio然后又卸载了lmstudio，那么这个命令会一直卡着，也不报错，所以要用一个10000ms的报错promise与它竞赛
      commandLine.exec('lms', ['ls']),
    ]);
    console.debug('isLMStudioInstall', result);
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
}

export async function movePodman(path: string) {
  let success = false;
  let errorMessage = '修改失败';
  if (!path || path === '') {
    errorMessage = '未选择正确的安装位置';
    return { success: false, errorMessage };
  }
  try {
    await stopPodman();
  } catch (e) {
    console.warn(e);
  }
  try {
    const output1 = await commandLine.exec(
      'wsl.exe',
      ['--shutdown', podMachineName],
      {
        encoding: 'utf16le',
        shell: true,
      },
    );
    console.debug('movePodman', output1);
    const output2 = await commandLine.exec(
      'wsl.exe',
      ['--manage', podMachineName, '--move', path],
      {
        encoding: 'utf16le',
        shell: true,
        logger: loggerFactory('podman'),
      },
    );
    console.debug('movePodman', output2);
    const output3 = await commandLine.exec(
      getPodmanCli(),
      ['machine', 'start'],
      {
        shell: true,
      },
    );
    console.debug('movePodman', output3);
    success = true;
  } catch (e) {
    console.warn('movePodman', e);
    if (
      e &&
      e.stdout &&
      e.stdout.indexOf('Wsl/Service/MoveDistro/0' + 'x80070070') >= 0
    ) {
      errorMessage = '磁盘空间不足';
    } else if (e && e.message.indexOf('exitCode: 4294967295') >= 0) {
      errorMessage = '修改失败，可能是WSL版本太低，请尝试升级WSL';
    }
    success = false;
  }

  return { success, errorMessage };
}
