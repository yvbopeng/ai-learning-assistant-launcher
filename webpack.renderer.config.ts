import type { Configuration } from 'webpack';
import webpack from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin';

rules.push();

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins: [
    new NodePolyfillPlugin({
      additionalAliases: [
        'path',
        'crypto',
        'fs',
        'http',
        'os',
      ]
    }),
    new webpack.ProvidePlugin({
      process: '/process-fast.js',
    }),
    new webpack.DefinePlugin({
      global: 'globalThis',
    }),
    ...plugins,
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.svg'],
    // aliasFields: ['browser'],
    alias: {
      // path: 'path-esm',
      './lib/conn-pool.js': false,
      './lib/utp.cjs': false,
      '@silentbot1/nat-api': false,
      'bittorrent-dht': false,
      // crypto: false,
      // fs: false,
      // 'fs-chunk-store': 'fsa-chunk-store',
      // http: false,
      'load-ip-set': false,
      net: false,
      // os: false,
      ut_pex: false,
    },
  },
};
