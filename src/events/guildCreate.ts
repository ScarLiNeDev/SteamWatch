import { Guild } from 'discord.js';
import db from '../db';

const REGION_CURRENCY_MAPPING: {
  [key: string]: string;
} = {
  brazil: 'BRL',
  europe: 'EUR',
  hongkong: 'HKD',
  india: 'INR',
  japan: 'JPY',
  russia: 'RUB',
  singapore: 'SGD',
  southafrica: 'ZAR',
  sydney: 'AUD',
  'us-central': 'USD',
  'us-east': 'USD',
  'us-south': 'USD',
  'us-west': 'USD',
};

export default async function guildCreate(guild: Guild) {
  const exists = await db.select('1')
    .from('guild')
    .where('id', guild.id)
    .first()
    .then((res) => !!res);

  if (exists) {
    return;
  }

  await db.insert({
    id: guild.id,
    name: guild.name,
    region: guild.region,
    memberCount: guild.memberCount,
    currencyId: REGION_CURRENCY_MAPPING[guild.region],
  }).into('guild');
}