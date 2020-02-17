import { oneLine } from 'common-tags';
import { RateLimitInfo } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import db from '../db';
import env from '../env';
import logger from '../logger';
import SteamWatchClient from './structures/SteamWatchClient';
import MariaDBProvider from './commando/providers/MariaDB';
import Steam from '../steam/Steam';

export default class Bot {
  private client: SteamWatchClient;

  constructor() {
    this.client = new SteamWatchClient({
      commandPrefix: env.bot.prefix,
      invite: env.bot.invite,
      messageCacheMaxSize: 1,
      owner: env.bot.owners,
      steam: new Steam(),
      unknownCommandResponse: false,
    });
  }

  async startAsync() {
    this.client.setProvider(new MariaDBProvider());

    this.client.registry
      .registerDefaultTypes()
      .registerTypesIn({
        filter: /^([^.].*)\.(js|ts)$/,
        dirname: join(__dirname, 'commando', 'types'),
      })
      .registerDefaultGroups()
      .registerGroups([['apps', 'Apps']])
      .registerCommandsIn({
        filter: /^([^.].*)\.(js|ts)$/,
        dirname: join(__dirname, 'commands'),
      });

    this.client.once('ready', async () => {
      logger.info({
        group: 'Discord',
        message: `Logged in as '${this.client.user.tag}'`,
      });

      this.setActivity();
    });

    this.client.setInterval(() => this.setActivity(), 300000);

    if (env.debug) {
      this.client.on('debug', (message) => logger.debug({ group: 'Discord', message }));
    }

    this.client.on('commandError', (_, err, message) => logger.error({
      group: 'Commando',
      message: `${message.content} : ${err}`,
    }));
    this.client.on('disconnect', () => logger.info({ group: 'Discord', message: 'Disconnected' }));
    this.client.on('error', (err) => logger.error({ group: 'Discord', message: err }));
    this.client.on('warn', (message) => logger.warn({ group: 'Discord', message }));
    this.client.on('rateLimit', (info: RateLimitInfo) => logger.warn({
      group: 'Discord',
      message: `Limit of ${info.limit} for ${info.method} ${info.path}`,
    }));
    this.client.on('reconnecting', () => logger.info({
      group: 'Discord',
      message: 'Reconnecting',
    }));
    this.client.on('resume', (replayed: number) => logger.info({
      group: 'Discord',
      message: `Resuming, replayed ${replayed} events`,
    }));

    const eventFiles = readdirSync(join(__dirname, 'events'))
      .filter((file) => !file.endsWith('.map'));
    const eventHandlers = await Promise
      .all(eventFiles.map((file) => import(join(__dirname, 'events', file))));
    eventFiles.forEach((file, i) => {
      this.client.on(file.split('.')[0], eventHandlers[i].default);
    });

    this.client.login(env.bot.token);
  }

  async stopAsync() {
    await this.client.destroy();
    db.destroy();
  }

  private async setActivity() {
    const count = await db.count('* AS count')
      .from('app')
      .innerJoin('app_watcher', 'app_watcher.app_id', 'app.id')
      .first()
      .then((res: any) => res.count);

    this.client.user.setActivity(
      oneLine`
        ${count} apps for ${this.client.guilds.size} guilds
        | ${this.client.commandPrefix}${this.client.commandPrefix.length > 1 ? ' ' : ''}help
      `,
      { type: 'WATCHING' },
    );
  }
}