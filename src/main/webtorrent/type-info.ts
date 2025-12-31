import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'webtorrent';

export const startWebtorrentHandle = `${channel}start`;

export const pauseWebtorrentHandle = `${channel}pause`;

export const removeWebtorrentHandle = `${channel}remove`;

export const queryWebtorrentHandle = `${channel}query`;

export const logsWebtorrentHandle = `${channel}logs`;

export const torrentNames = [
  'PDF_TAR',
  'VOICE_TAR',
  'TRAINING_TAR',
  'TRAINING_VOICE_TAR',
  'LMSTUDIO_WINDOWS',
  '',
] as const;

export type TorrentName = (typeof torrentNames)[number];
