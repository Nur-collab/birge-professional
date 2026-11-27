import { Building2, Compass, Layers, Navigation, ShoppingBag } from 'lucide-react';

export const BISHKEK_HUBS = [
  { name: 'ЦУМ (Центр)', cat: 'center' },
  { name: 'ТРК Asia Mall', cat: 'center' },
  { name: 'Южная Магистраль', cat: 'center' },
  { name: 'Политех / БГУ', cat: 'center' },
  { name: 'мкр. Асанбай', cat: 'districts' },
  { name: 'мкр. Джал', cat: 'districts' },
  { name: 'мкр. Тунгуч', cat: 'districts' },
  { name: 'мкр. Восток-5', cat: 'districts' },
  { name: 'ЖК «Ала-Арча»', cat: 'districts' },
  { name: 'ж/м Ак-Өргө', cat: 'districts' },
  { name: 'Рынок Дордой', cat: 'markets' },
  { name: 'Ошский базар', cat: 'markets' },
  { name: 'Аламединский базар', cat: 'markets' },
  { name: 'Кудайберген', cat: 'markets' },
  { name: 'Аэропорт Манас', cat: 'chuy' },
  { name: 'г. Кант', cat: 'chuy' },
  { name: 'г. Токмок', cat: 'chuy' },
  { name: 'с. Сокулук', cat: 'chuy' },
  { name: 'г. Кара-Балта', cat: 'chuy' },
];

export const HUB_CATEGORIES = [
  { id: 'all', labelKey: 'dash.cat_all', icon: Layers },
  { id: 'center', labelKey: 'dash.cat_center', icon: Building2 },
  { id: 'districts', labelKey: 'dash.cat_districts', icon: Compass },
  { id: 'markets', labelKey: 'dash.cat_markets', icon: ShoppingBag },
  { id: 'chuy', labelKey: 'dash.cat_chuy', icon: Navigation },
];
