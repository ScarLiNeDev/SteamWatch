import { oneLine, stripIndents } from 'common-tags';
import { decode } from 'html-entities';
import {
  ButtonStyle,
  ComponentType,
  MessageEmbedOptions,
  MessageOptions,
} from 'slash-create';
import DiscordUtil from './DiscordUtil';
import {
  DEFAULT_CURRENCY,
  DEFAULT_STEAM_ICON,
  EMBED_COLOURS,
  EMOJIS,
} from '../constants';
import db, {
  App,
  Currency,
  CurrencyCode,
  Forum,
  FreePackage,
  FreePackageType,
  Group,
  PriceType,
  WatcherType,
} from '../db';
import SteamAPI, {
  CuratorReview,
  ForumThread,
  NewsPost,
  PartnerEvent,
  PriceOverview,
  StoreItem,
  Tag,
} from '../steam/SteamAPI';
import steamClient from '../steam/SteamClient';
import { EWorkshopFileType, PublishedFile, SteamDeckCompatibility } from '../steam/SteamWatchUser';
import SteamUtil from '../steam/SteamUtil';
import transformArticle from '../transformers';

export type AppMinimal = Pick<App, 'icon' | 'id' | 'name'>;
export type ForumMinimal = Pick<Forum, 'name'>
& {
  appId: App['id'],
  appIcon: App['icon'],
  groupAvatar: Group['avatar']
};
export type GroupMinimal = Pick<Group, 'avatar' | 'id' | 'name'>;

export default class EmbedBuilder {
  static createApp(
    app: AppMinimal,
    {
      description,
      timestamp,
      title,
      url,
    }: Required<Pick<MessageEmbedOptions, 'description' | 'timestamp' | 'title' | 'url'>>,
  ): MessageEmbedOptions {
    return {
      color: EMBED_COLOURS.DEFAULT,
      title,
      description,
      footer: {
        icon_url: SteamUtil.URLS.Icon(app.id, app.icon),
        text: app.name,
      },
      url,
      timestamp,
      thumbnail: {
        url: SteamUtil.URLS.Icon(app.id, app.icon),
      },
    };
  }

  static createCuratorReview(
    app: AppMinimal,
    curator: GroupMinimal,
    review: CuratorReview,
  ): MessageEmbedOptions {
    let color = EMBED_COLOURS.DEFAULT;
    if (review.status === 'Not Recommended') {
      color = EMBED_COLOURS.ERROR;
    } else if (review.status === 'Informational') {
      color = EMBED_COLOURS.PENDING;
    }

    return {
      author: {
        name: curator.name,
        icon_url: SteamUtil.URLS.GroupAvatar(curator.avatar, 'medium'),
        url: SteamUtil.URLS.Curator(curator.id),
      },
      title: app!.name,
      color,
      description: `> "${review.description.trim() || 'N/A'}"`,
      url: `${SteamUtil.URLS.Store(review.appId, PriceType.App)}?curator_clanid=${curator.id}`,
      timestamp: review.date,
      thumbnail: {
        url: SteamUtil.URLS.Icon(review.appId, app!.icon),
      },
      footer: {
        text: review.status,
        icon_url: SteamUtil.URLS.Icon(review.appId, app!.icon),
      },
      fields: [{
        name: 'Steam Client Link',
        value: SteamUtil.BP.StoreApp(review.appId),
      }],
    };
  }

  static createForumPost(
    forum: ForumMinimal,
    post: ForumThread,
  ): MessageEmbedOptions {
    let emoji = '';

    if (post.locked) {
      emoji = EMOJIS.LOCK;
    } else if (post.solved) {
      emoji = EMOJIS.CHECK;
    } else if (post.sticky) {
      emoji = EMOJIS.PIN;
    }

    return {
      author: {
        name: post.author,
      },
      title: `${emoji} ${post.title}`,
      color: EMBED_COLOURS.DEFAULT,
      description: post.contentPreview,
      url: post.url,
      timestamp: post.lastPostAt,
      thumbnail: {
        url: EmbedBuilder.getImage(WatcherType.Forum, {
          ...forum,
          groupAvatarSize: 'medium',
        }),
      },
      footer: {
        text: forum.name,
        icon_url: EmbedBuilder.getImage(WatcherType.Forum, {
          ...forum,
          groupAvatarSize: 'medium',
        }),
      },
      fields: [{
        name: 'Steam Client Link',
        value: SteamUtil.BP.OpenUrl(post.url),
      }],
    };
  }

  static createFreePackage(
    app: AppMinimal,
    pkg: FreePackage,
  ): MessageEmbedOptions {
    return {
      ...EmbedBuilder.createApp(app, {
        description: `**${(pkg.type === FreePackageType.Promo ? 'Free To Keep' : 'Free Weekend')}**`,
        timestamp: new Date(),
        title: app.name,
        url: SteamUtil.URLS.Store(app.id, PriceType.App),
      }),
      fields: [{
        name: 'Starts',
        value: `<t:${pkg.startTime!.getTime() / 1000}:F>`,
        inline: true,
      }, {
        name: 'Ends',
        value: `<t:${pkg.endTime!.getTime() / 1000}:F>`,
        inline: true,
      }, {
        name: 'Steam Client Link',
        value: SteamUtil.BP.StoreApp(app.id),
      }],
    };
  }

  static async createGroupNews(
    group: GroupMinimal,
    news: PartnerEvent,
  ): Promise<MessageEmbedOptions> {
    const author = await SteamAPI.getPlayerSummary(news.posterid);
    const transformed = transformArticle(news.body);

    return {
      color: EMBED_COLOURS.DEFAULT,
      title: news.headline,
      description: transformed.markdown,
      footer: {
        icon_url: SteamUtil.URLS.GroupAvatar(group.avatar, 'medium'),
        text: group.name,
      },
      url: SteamUtil.URLS.EventAnnouncement(group.id, news.gid, 'group'),
      timestamp: new Date(news.posttime * 1000),
      thumbnail: {
        url: SteamUtil.URLS.GroupAvatar(group.avatar, 'full'),
      },
      ...(author ? {
        author: {
          name: author.personaname,
          icon_url: author.avatar,
          url: SteamUtil.URLS.Profile(author.steamid),
        },
      } : {}),
      ...(transformed.thumbnail ? {
        image: {
          url: SteamUtil.URLS.NewsImage(transformed.thumbnail),
        },
      } : {}),
    };
  }

  static async createNews(app: AppMinimal, news: NewsPost): Promise<MessageEmbedOptions> {
    const transformed = transformArticle(news.contents);
    const eventId = await SteamAPI.getEventIdForArticle(news.url);

    return {
      ...this.createApp(app, {
        // Truncate long news titles
        title: news.title.length > 128 ? `${news.title.substring(0, 125)}...` : news.title,
        description: transformed.markdown,
        url: eventId
          ? SteamUtil.URLS.EventAnnouncement(app.id, eventId, PriceType.App)
          : news.url,
        timestamp: new Date(news.date * 1000),
      }),
      ...(news.author ? {
        author: {
          name: news.author,
        },
      } : {}),
      ...(transformed.thumbnail ? {
        image: {
          url: SteamUtil.URLS.NewsImage(transformed.thumbnail),
        },
      } : {}),
      fields: eventId
        ? [{
          name: 'Steam Client Link',
          value: SteamUtil.BP.EventAnnouncement(app.id, eventId),
        }] : [],
    };
  }

  static createPrice(
    app: AppMinimal,
    currencyCode: CurrencyCode,
    priceOverview: PriceOverview,
  ): MessageEmbedOptions {
    return {
      ...this.createApp(app, {
        description: SteamUtil.formatPriceDisplay({
          currency: currencyCode,
          discount: priceOverview.discount_percent,
          final: priceOverview.final,
          initial: priceOverview.initial,
        }),
        timestamp: new Date(),
        title: app.name,
        url: SteamUtil.URLS.Store(app.id, PriceType.App),
      }),
      fields: [{
        name: 'Steam Client Link',
        value: SteamUtil.BP.StoreApp(app.id),
      }],
    };
  }

  static async createStore(appId: number, guildId?: string): Promise<MessageOptions | null> {
    let currency: Pick<Currency, 'code' | 'countryCode'> = !guildId
      ? DEFAULT_CURRENCY
      : await db.select('code', 'country_code')
        .from('currency')
        .innerJoin('guild', 'guild.currency_id', 'currency.id')
        .where('guild.id', guildId)
        .first();
    currency = currency || DEFAULT_CURRENCY;

    const [details, steamdeck] = await Promise.all([
      SteamAPI.getAppDetails(appId, currency.countryCode),
      steamClient.getProductInfo([appId], []),
    ]);
    let playerCount: number | null = null;

    if (details?.type === 'game') {
      playerCount = await SteamAPI.getNumberOfCurrentPlayers(appId!);
    }

    if (!details) {
      return null;
    }

    let price = 'N/A';

    if (details.is_free) {
      price = '**Free**';
    } else if (details.price_overview) {
      price = SteamUtil.formatPriceDisplay({
        currency: currency.code,
        discount: details.price_overview.discount_percent,
        final: details.price_overview.final,
        initial: details.price_overview.initial,
      });
    }

    const steamdeckCompatibility = parseInt(
      steamdeck.apps[appId]?.appinfo
        .common
        .steam_deck_compatibility
        ?.category
      ?? SteamDeckCompatibility.Unknown,
      10,
    );

    return {
      embeds: [{
        color: EMBED_COLOURS.DEFAULT,
        description: decode(details.short_description) || '',
        title: details.name,
        image: {
          url: details.header_image,
        },
        timestamp: new Date(),
        url: SteamUtil.URLS.Store(appId!, PriceType.App),
        fields: [
          {
            name: 'Price',
            value: price,
            inline: true,
          },
          ...(details.developers?.length ? [{
            name: 'Developers',
            value: details.developers.join('\n') || 'Unknown',
            inline: true,
          }] : []),
          ...(details.publishers?.length && details.publishers[0]?.length ? [{
            name: 'Publishers',
            value: details.publishers.join('\n'),
            inline: true,
          }] : []),
          ...(playerCount !== null ? [{
            name: 'Player Count',
            value: playerCount.toString(),
            inline: true,
          }] : []),
          ...(details.release_date ? [{
            name: 'Release Date',
            value: details.release_date.date || 'Unknown',
            inline: true,
          }] : []),
          ...(details.achievements || details.recommendations ? [{
            name: 'Details',
            value: stripIndents`
              ${DiscordUtil.getStateEmoji(details.achievements)} **Achievements:** ${details.achievements?.total || 0}
              ${DiscordUtil.getStateEmoji(details.recommendations)} **Recommendations:** ${details.recommendations?.total || 0}
            `,
            inline: true,
          }] : []),
          ...(details.categories?.length ? [{
            name: 'Categories',
            value: details.categories.map((c: Tag) => c.description).join('\n'),
            inline: true,
          }] : []),
          ...(details.genres?.length ? [{
            name: 'Genres',
            value: details.genres.map((g: Tag) => g.description).join('\n'),
            inline: true,
          }] : []),
          ...(details.platforms ? [{
            name: 'Platforms',
            value: stripIndents`
              ${DiscordUtil.getStateEmoji(details.platforms.windows)} **Windows**
              ${DiscordUtil.getStateEmoji(details.platforms.mac)} **Mac**
              ${DiscordUtil.getStateEmoji(details.platforms.linux)} **Linux**
            `,
            inline: true,
          }] : []),
          {
            name: 'Steam Deck Compatibility',
            value: oneLine`
              ${steamdeckCompatibility === SteamDeckCompatibility.Verified ? EMOJIS.SUCCESS : ''}
              ${steamdeckCompatibility === SteamDeckCompatibility.Playable ? EMOJIS.WARNING : ''}
              ${steamdeckCompatibility === SteamDeckCompatibility.Unsupported ? EMOJIS.ERROR : ''}
              **${SteamDeckCompatibility[steamdeckCompatibility] || 'Unknown'}**
            `,
          },
          {
            name: 'Steam Client Link',
            value: SteamUtil.BP.StoreApp(appId!),
          },
        ],
      }],
      components: (details.website ? [{
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            label: 'View Website',
            style: ButtonStyle.LINK,
            url: details.website,
          },
        ],
      },
      ] : []),
    };
  }

  static createStoreItem(item: StoreItem, message: string) {
    let bp = SteamUtil.BP.StoreApp(item.id);
    let priceType = PriceType.App;

    if (item.type === PriceType.Bundle) {
      bp = SteamUtil.BP.StoreBundle(item.id);
      priceType = PriceType.Bundle;
    } else if (item.type === PriceType.Sub) {
      bp = SteamUtil.BP.StoreSub(item.id);
      priceType = PriceType.Sub;
    }

    const embed = EmbedBuilder.createApp(item, {
      title: item.name,
      description: message,
      url: SteamUtil.URLS.Store(item.id, priceType),
      timestamp: new Date(),
    });

    // We only have icons for apps
    if (item.type !== 'app') {
      delete embed.footer!.icon_url;
      delete embed.thumbnail;
    }

    embed.fields = [{
      name: 'Steam Client Link',
      value: bp,
    }];

    return embed;
  }

  static async createWorkshop(app: AppMinimal, file: PublishedFile, timestamp: keyof Pick<PublishedFile, 'time_created' | 'time_updated'>): Promise<MessageEmbedOptions> {
    const author = await SteamAPI.getPlayerSummary(file.creator);

    return {
      ...this.createApp(app, {
        description: transformArticle(file.file_description).markdown,
        timestamp: new Date(file[timestamp] * 1000),
        title: file.title,
        url: SteamUtil.URLS.UGC(file.publishedfileid),
      }),
      ...(author ? {
        author: {
          name: author.personaname,
          icon_url: author.avatar,
          url: SteamUtil.URLS.Profile(author.steamid),
        },
      } : {}),
      ...(file.preview_url ? {
        image: {
          url: file.preview_url,
        },
      } : {}),
      fields: [{
        name: 'Tags',
        value: file.tags.map((tag) => tag.tag).join('\n') || 'None',
        inline: true,
      },
      {
        name: 'Type',
        value: EWorkshopFileType[file.file_type] || 'Unknown',
        inline: true,
      },
      ...([
        EWorkshopFileType.Art,
        EWorkshopFileType.Item,
        EWorkshopFileType.Microtransaction,
        EWorkshopFileType.Screenshot,
        EWorkshopFileType.WebGuide,
      ].includes(file.file_type) ? [{
          name: 'File Size',
          value: SteamUtil.formatFileSize(parseInt(file.file_size, 10)),
          inline: true,
        }] : []),
      {
        name: 'Steam Client Link',
        value: SteamUtil.BP.UGC(file.publishedfileid),
      }],
    };
  }

  static getImage(type: WatcherType, options: {
    appId: App['id'],
    appIcon: App['icon'],
    groupAvatar: Group['avatar'],
    groupAvatarSize: 'full' | 'medium'
  }) {
    switch (type) {
      case WatcherType.Forum:
        return options.appId
          ? SteamUtil.URLS.Icon(options.appId, options.appIcon)
          : SteamUtil.URLS.GroupAvatar(options.groupAvatar, options.groupAvatarSize);
      case WatcherType.Free:
        return DEFAULT_STEAM_ICON;
      case WatcherType.Curator:
      case WatcherType.Group:
        return SteamUtil.URLS.GroupAvatar(options.groupAvatar, options.groupAvatarSize);
      default:
        return SteamUtil.URLS.Icon(options.appId, options.appIcon);
    }
  }
}
