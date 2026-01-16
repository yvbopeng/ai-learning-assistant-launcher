import { IpcMain } from 'electron';
import https from 'node:https';
import {
  ActionName,
  channel,
  ServiceName,
  RemoteVersionInfo,
} from './type-info';
import { MESSAGE_TYPE, MessageData } from '../ipc-data-type';

const REMOTE_INDEX_URL = 'https://yubopeng.site/index.json';

// 服务ID映射
const SERVICE_ID_MAP: Record<ServiceName, string> = {
  launcher: 'AI_LEARNING_ASSISTANT_LAUNCHER',
  training: 'TRAINING_TAR',
};

// 从远程获取版本信息
async function fetchRemoteIndex(): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const request = https.get(REMOTE_INDEX_URL, (response) => {
      // 处理重定向
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          https
            .get(redirectUrl, (res) => {
              let data = '';
              res.on('data', (chunk) => {
                data += chunk;
              });
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(new Error('解析远程版本信息失败'));
                }
              });
            })
            .on('error', reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP error! status: ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('解析远程版本信息失败'));
        }
      });
    });

    request.on('error', (err) => {
      reject(err);
    });

    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('请求超时'));
    });
  });
}

// 比较版本号，获取最新版本
function getLatestVersion(versions: string[]): string {
  return versions.sort((a, b) => {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) return numB - numA;
    }
    return 0;
  })[0];
}

// 获取指定服务的版本信息
async function getVersionInfo(
  serviceName: ServiceName,
): Promise<RemoteVersionInfo | null> {
  try {
    const data = await fetchRemoteIndex();
    const serviceId = SERVICE_ID_MAP[serviceName];
    const serviceInfo = data.find((item: any) => item.id === serviceId);

    if (!serviceInfo || !serviceInfo.versions) {
      return null;
    }

    const versions = Object.keys(serviceInfo.versions);
    const latestVersion = getLatestVersion(versions);
    const magnet = serviceInfo.versions[latestVersion]?.magnet || '';

    console.log('=== 远程版本信息 ===');
    console.log('服务:', serviceName);
    console.log('最新版本号:', latestVersion);
    console.log('下载链接:', magnet);
    console.log('===================');

    return {
      id: serviceInfo.id,
      name: serviceInfo.name,
      latestVersion,
      magnet,
      allVersions: serviceInfo.versions,
    };
  } catch (error) {
    console.error('获取远程版本信息失败:', error);
    throw error;
  }
}

export default async function init(ipcMain: IpcMain) {
  ipcMain.on(
    channel,
    async (event, action: ActionName, serviceName: ServiceName) => {
      console.debug(
        `webtorrent action: ${action}, serviceName: ${serviceName}`,
      );

      if (action === 'checkUpdate' || action === 'getVersionInfo') {
        try {
          const versionInfo = await getVersionInfo(serviceName);
          if (versionInfo) {
            event.reply(
              channel,
              MESSAGE_TYPE.DATA,
              new MessageData(action, serviceName, versionInfo),
            );
          } else {
            event.reply(channel, MESSAGE_TYPE.ERROR, '未找到版本信息');
          }
        } catch (error) {
          event.reply(
            channel,
            MESSAGE_TYPE.ERROR,
            `获取版本信息失败: ${error.message || '未知错误'}`,
          );
        }
      } else {
        event.reply(channel, MESSAGE_TYPE.ERROR, '不支持的操作');
      }
    },
  );
}
