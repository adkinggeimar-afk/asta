import type { BackdropThemeId } from '../shared/countdown';

export interface BackdropThemeMeta {
  id: BackdropThemeId;
  name: string;
  nameBn: string;
  imageUrl: string | null;
  swatchClass: string;
}

export const BACKDROP_THEMES: ReadonlyArray<BackdropThemeMeta> = [
  {
    id: 'obsidian',
    name: 'Obsidian Studio',
    nameBn: 'অবসিডিয়ান স্টুডিও',
    imageUrl: '/src/assets/images/backdrop_obsidian_studio_1795365224809.jpg',
    swatchClass: 'bg-gradient-to-br from-slate-800 via-slate-900 to-black',
  },
  {
    id: 'midnight',
    name: 'Midnight Horizon',
    nameBn: 'মিডনাইট হরাইজন',
    imageUrl: '/src/assets/images/backdrop_midnight_horizon_1795365224383.jpg',
    swatchClass: 'bg-gradient-to-br from-slate-900 via-blue-950 to-slate-950',
  },
  {
    id: 'amber',
    name: 'Amber Stage',
    nameBn: 'অ্যাম্বার স্টেজ',
    imageUrl: '/src/assets/images/backdrop_amber_stage_1795365224327.jpg',
    swatchClass: 'bg-gradient-to-br from-stone-800 via-amber-950/60 to-black',
  },
  {
    id: 'minimal',
    name: 'Minimal Matte',
    nameBn: 'মিনিমাল ম্যাট',
    imageUrl: null,
    swatchClass: 'bg-[#0B0F17]',
  },
];

export function getThemeMeta(themeId: BackdropThemeId): BackdropThemeMeta {
  return BACKDROP_THEMES.find((t) => t.id === themeId) ?? BACKDROP_THEMES[0];
}
