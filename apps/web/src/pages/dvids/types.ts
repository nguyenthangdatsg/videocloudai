export interface DvidsSearchResult {
  id: string;
  title: string;
  short_description: string;
  date_published: string;
  branch: string;
  unit_name: string;
  category: string;
  duration: number;
  aspect_ratio: string;
  thumbnail: string;
  url: string;
  keywords: string[];
  credit: string;
  width: number;
  height: number;
}

export interface DvidsImportedAsset {
  id: number;
  dvids_id: string;
  title: string;
  description: string | null;
  short_description: string | null;
  virin: string | null;
  branch: string | null;
  unit_name: string | null;
  credit: Array<{ name: string; rank: string }>;
  category: string | null;
  keywords: string[];
  tags: string[];
  date_published: string | null;
  duration: number | null;
  aspect_ratio: string | null;
  thumbnail_url: string | null;
  local_filename: string | null;
  local_path: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
  dvids_url: string | null;
  is_favorite: boolean;
  collection: string | null;
  imported_at: string;
}

export interface DvidsSearchFilters {
  q: string;
  branch: string;
  category: string;
  aspectRatio: string;
  hd: boolean;
  fromDuration: string;
  toDuration: string;
  fromDate: string;
  toDate: string;
  sort: string;
  sortDir: string;
  page: number;
}

export const DVIDS_BRANCHES = [
  'Air Force', 'Army', 'Navy', 'Marines', 'Coast Guard', 'Space Force', 'Joint', 'Civilian',
] as const;

export const DVIDS_CATEGORIES = [
  'B-Roll', 'Combat Operations', 'Interviews', 'Newscasts', 'Briefings',
  'Commercials', 'PSA', 'Series', 'Package', 'Miscellaneous',
] as const;

export const BRANCH_COLORS: Record<string, string> = {
  'Air Force': 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  'Army': 'bg-green-600/20 text-green-400 border-green-600/30',
  'Navy': 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30',
  'Marines': 'bg-red-600/20 text-red-400 border-red-600/30',
  'Coast Guard': 'bg-orange-600/20 text-orange-400 border-orange-600/30',
  'Space Force': 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  'Joint': 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  'Civilian': 'bg-gray-600/20 text-gray-400 border-gray-600/30',
};
