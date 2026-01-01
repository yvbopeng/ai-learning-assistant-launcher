import { IpcMain, app } from 'electron';
import {
  logsWebtorrentHandle,
  startWebtorrentHandle,
  queryWebtorrentHandle,
  pauseWebtorrentHandle,
  removeWebtorrentHandle,
  DLCId,
  DLCIndex,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import WebTorrent, * as allExports from 'webtorrent';
import path from 'path';
import { appPath } from '../exec';
import { existsSync, readFileSync } from 'fs';

let client: WebTorrent.Instance | null = null;
const getWebTorrent = async () => {
  const WebTorrentClass =
    // @ts-ignore
    (await allExports.default).default;
  client = new WebTorrentClass() as WebTorrent.Instance;
  return client;
};

// const getWebTorrent = async () => {
//   // @ts-ignore
//   return new WebTorrent();
// };

export default async function init(ipcMain: IpcMain) {
  client = await getWebTorrent();
  ipcHandle(ipcMain, startWebtorrentHandle, async (_event, url: string) =>
    startWebtorrent(url),
  );
  ipcHandle(ipcMain, queryWebtorrentHandle, async (_event) =>
    queryWebtorrent(),
  );
  ipcHandle(ipcMain, pauseWebtorrentHandle, async (_event, url: string) =>
    pauseWebtorrent(url),
  );
  ipcHandle(ipcMain, removeWebtorrentHandle, async (_event, url: string) =>
    removeWebtorrent(url),
  );
  ipcHandle(ipcMain, logsWebtorrentHandle, async (_event, url: string) =>
    logsWebtorrent(url),
  );
}

export async function startWebtorrent(url: string) {
  client.add(
    url,
    { path: path.join(appPath, 'external-resources', 'dlc') },
    (torrent) => {
      // Got torrent metadata!
      console.log('Client is downloading:', torrent.infoHash);
      console.log(`[add] 开始下载 ${torrent.name}`);
      console.log(`[add] 存储地址 ${torrent.path}`);
      torrent.on('download', () => {
        const progressPercent = (torrent.progress * 100).toFixed(2);
        const downloadedMB = (torrent.downloaded / 1024 / 1024).toFixed(2);
        const totalMB = (torrent.length / 1024 / 1024).toFixed(2);
        console.log(
          `\r📥 下载进度：${downloadedMB} MB / ${totalMB} MB (${progressPercent}%)`,
        );
      });
    },
  );
}

export async function queryWebtorrent() {
  return getDLCIndex();
}

export async function pauseWebtorrent(url: string) {}

export async function removeWebtorrent(url: string) {}

export async function logsWebtorrent(url: string) {}

const dlcIndexPath = path.join(
  appPath,
  'external-resources',
  'dlc',
  'dlc-index.json',
);
let currentDLCIndex = [];
// 添加获取大模型配置的函数
export function getDLCIndex(): DLCIndex {
  try {
    if (existsSync(dlcIndexPath)) {
      const configString = readFileSync(dlcIndexPath, {
        encoding: 'utf8',
      });
      const config = JSON.parse(configString) as DLCIndex;
      currentDLCIndex = config;
    }
    return currentDLCIndex;
  } catch (error) {
    console.error('读取DLC索引失败:', error);
    return [];
  }
}
