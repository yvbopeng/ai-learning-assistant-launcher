import { IpcMain, app } from 'electron';
import {
  logsWebtorrentHandle,
  startWebtorrentHandle,
  queryWebtorrentHandle,
  pauseWebtorrentHandle,
  removeWebtorrentHandle,
  DLCIndex,
  DLCId,
  OneDLCInfo,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import WebTorrent, * as allExports from 'webtorrent';
import path from 'path';
import { appPath } from '../exec';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import patchCA from './patch-ca';

patchCA();

let client: WebTorrent.Instance | null = null;
const getWebTorrent = async () => {
  const WebTorrentClass: WebTorrent.WebTorrent =
    // @ts-ignore
    (await allExports.default).default;

  const iceServers = [{ urls: 'stun:learning.panchuantech.cn:19244' }];
  // try {
  //   const ac = new AbortController();
  //   const t = setTimeout(ac.abort, 3000);
  //   const stuns = await (
  //     await fetch(
  //       'https://hub.gitmirror.com/raw.githubusercontent.com/pradt2/always-online-stun/master/valid_hosts.txt',
  //       { signal: ac.signal },
  //     )
  //   ).text();
  //   clearTimeout(t);
  //   iceServers = stuns.split('\n').map((urls) => ({ urls }));
  // } catch (error) {
  //   console.log('获取公共stun失败，使用默认stun');
  // }
  console.log(iceServers);

  client = new WebTorrentClass({
    lsd: true,
    tracker: {
      // WebRTC 相关的配置放在这里
      rtcConfig: {
        iceServers,
      } as RTCConfiguration,
      announce: ['wss://learning.panchuantech.cn/announce'],
    },
  });

  return client;
};

// const getWebTorrent = async () => {
//   // @ts-ignore
//   return new WebTorrent();
// };

export default async function init(ipcMain: IpcMain) {
  client = await getWebTorrent();
  ipcHandle(ipcMain, startWebtorrentHandle, async (_event, magnet: string) =>
    startWebtorrent(magnet),
  );
  ipcHandle(ipcMain, queryWebtorrentHandle, async (_event) =>
    queryWebtorrent(),
  );
  ipcHandle(ipcMain, pauseWebtorrentHandle, async (_event, magnet: string) =>
    pauseWebtorrent(magnet),
  );
  ipcHandle(ipcMain, removeWebtorrentHandle, async (_event, magnet: string) =>
    removeWebtorrent(magnet),
  );
  ipcHandle(ipcMain, logsWebtorrentHandle, async (_event, magnet: string) =>
    logsWebtorrent(magnet),
  );
  ipcHandle(ipcMain, logsWebtorrentHandle, async (_event, magnet: string) =>
    logsWebtorrent(magnet),
  );
}

export async function startWebtorrent(magnet: string) {
  const torrent = await client.get(magnet);
  const dLCInfo = getIndexVersionByMegnet(magnet);

  if (torrent) {
    torrent.resume();
    return;
  } else {
    if (dLCInfo) {
      const filePath = path.join(
        appPath,
        'external-resources',
        'dlc',
        dLCInfo.dlc.id,
        dLCInfo.version,
      );
      if (!existsSync(filePath)) {
        mkdirSync(filePath, { recursive: true });
      }
      client.add(
        magnet,
        {
          path: filePath,
        },
        (torrent) => {
          // Got torrent metadata!
          console.debug('Client is downloading:', torrent.infoHash);
          console.debug(`[add] 开始下载 ${torrent.name}`);
          console.debug(`[add] 存储地址 ${torrent.path}`);
        },
      );
    } else {
      console.warn('没找到链接对应的索引信息', magnet);
    }
  }
}

export async function queryWebtorrent() {
  return getDLCIndex();
}

export async function pauseWebtorrent(magnet: string) {
  const torrent = await client.get(magnet);
  if (torrent) {
    torrent.pause();
  }
}

export async function removeWebtorrent(magnet: string) {
  const torrent = await client.get(magnet);
  if (torrent) {
    torrent.pause();
    for (const file of torrent.files) {
      const fullPath = path.join(torrent.path, file.path);
      console.debug('deleteing', fullPath);
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
        console.debug('deleted', fullPath);
      }
    }
    torrent.destroy();
  }
}

export async function logsWebtorrent(magnet: string) {}

const dlcIndexPath = path.join(
  appPath,
  'external-resources',
  'dlc',
  'dlc-index.json',
);
let currentDLCIndex: DLCIndex = [];
/** 读取DLC索引文件 */
export function getDLCIndex(): DLCIndex {
  try {
    if (existsSync(dlcIndexPath)) {
      const configString = readFileSync(dlcIndexPath, {
        encoding: 'utf8',
      });
      const config = JSON.parse(configString) as DLCIndex;
      currentDLCIndex = config;
    }
    for (const dlc of currentDLCIndex) {
      for (const v in dlc.versions) {
        const version = dlc.versions[v];
        const progress = getProgress(version.magnet);
        version.progress = progress;
      }
    }
    return currentDLCIndex;
  } catch (error) {
    console.error('读取DLC索引失败:', error);
    return [];
  }
}

export function getDLCFromDLCIndex(id: DLCId): OneDLCInfo {
  const dlcIndex = getDLCIndex();
  const num = dlcIndex.findIndex((dlc) => dlc.id === id);
  if (num >= 0) {
    return dlcIndex[num];
  } else {
    throw new Error(`找不到${id}的信息`);
  }
}

export function getLatestVersionFromDLCIndex(
  id: DLCId,
): OneDLCInfo['versions'][string] {
  const dlc = getDLCFromDLCIndex(id);
  // TODO 帮忙返回dlc.versions 中版本最新的一个对象
  return dlc.versions['2.0.0'];
}

export function isLatest(id: DLCId, version: string): boolean {
  const dlc = getDLCFromDLCIndex(id);
  // TODO 帮忙检查version是否是dlc.versions中最新的版本
  return false;
}

export function getIndexVersionByMegnet(magnet: string) {
  const dLCIndex = getDLCIndex();
  for (const dlc of dLCIndex) {
    for (const v in dlc.versions) {
      const version = dlc.versions[v];
      if (version.magnet === magnet) {
        return {
          dlc,
          version: v,
        };
      }
    }
  }
}

function getProgress(magnet?: string) {
  if (!magnet) {
    return null;
  }
  const params = new URL(magnet).searchParams;
  const xt = params.get('xt');
  const torrent = client.torrents.filter((torrent) => {
    const hash = xt.split(':')?.pop();
    // console.debug('hash', hash, 'infohash', torrent.infoHash);
    return torrent.infoHash === hash;
  })[0];
  if (torrent) {
    return shallowCopyPrimitives(torrent);
  }
  return null;
}

function shallowCopyPrimitives<T extends object>(obj: T): T {
  const result = {} as T;
  if (!obj) {
    return obj;
  }
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      // 只复制字符串、数字、boolean类型
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        result[key] = value;
      }
    }
  }
  return result;
}
