import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'webtorrent';

export const startWebtorrentHandle = `${channel}start`;

export const pauseWebtorrentHandle = `${channel}pause`;

export const removeWebtorrentHandle = `${channel}remove`;

export const queryWebtorrentHandle = `${channel}query`;

export const logsWebtorrentHandle = `${channel}logs`;

export const dLCIds = [
  'PDF_TAR',
  'VOICE_TAR',
  'TRAINING_TAR',
  'TRAINING_VOICE_TAR',
  'LMSTUDIO_WINDOWS',
  'TEST_FILE',
] as const;

export type DLCId = (typeof dLCIds)[number];

export type OneDLCInfo = {
  id: DLCId;
  name: string;
  versions: {
    '1.0.0': '';
  };
};

export type DLCIndex = OneDLCInfo[];
