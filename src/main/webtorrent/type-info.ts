import type { Channels } from '../ipc-data-type';

export type ServiceName = 'launcher' | 'training';
export type ActionName = 'checkUpdate' | 'getVersionInfo';

export const channel: Channels = 'webtorrent';

export interface RemoteVersionInfo {
  id: string;
  name: string;
  latestVersion: string;
  magnet: string;
  allVersions: Record<string, { magnet: string }>;
}
