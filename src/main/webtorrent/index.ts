import { IpcMain, app } from 'electron';
import {
  logsWebtorrentHandle,
  startWebtorrentHandle,
  queryWebtorrentHandle,
  pauseWebtorrentHandle,
  removeWebtorrentHandle,
  TorrentName,
} from './type-info';
import { ipcHandle } from '../ipc-util';
import WebTorrent, * as allExports from 'webtorrent';
import path from 'path';

const url_remote =
  'magnet:?xt=urn:btih:f9b78a4446db8ca74f89fd973b35a6eec497b55d&dn=p2p-demo.mp4&tr=ws%3A%2F%2F121.40.137.135%3A8200';

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
  const client = await getWebTorrent();
  client.add(
    url_remote,
    { path: path.join(app.getPath('downloads'), 'test.mp4') },
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
  ipcHandle(
    ipcMain,
    startWebtorrentHandle,
    async (_event, torrentName: TorrentName) => startWebtorrent(torrentName),
  );
  ipcHandle(
    ipcMain,
    queryWebtorrentHandle,
    async (_event, torrentName: TorrentName) => queryWebtorrent(torrentName),
  );
  ipcHandle(
    ipcMain,
    pauseWebtorrentHandle,
    async (_event, torrentName: TorrentName) => pauseWebtorrent(torrentName),
  );
  ipcHandle(
    ipcMain,
    removeWebtorrentHandle,
    async (_event, torrentName: TorrentName) => removeWebtorrent(torrentName),
  );
  ipcHandle(
    ipcMain,
    logsWebtorrentHandle,
    async (_event, torrentName: TorrentName) => queryWebtorrent(torrentName),
  );
}

export async function startWebtorrent(torrentName: TorrentName) {}

export async function queryWebtorrent(torrentName: TorrentName) {}

export async function pauseWebtorrent(torrentName: TorrentName) {}

export async function removeWebtorrent(torrentName: TorrentName) {}

export async function logsWebtorrent(torrentName: TorrentName) {}
