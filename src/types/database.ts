// DB の型。supabase/migrations の内容に合わせて手で書いている。
// テーブルを変えたらここも合わせて直すこと。

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type PublishStatus = "private" | "public" | "limited";
export type SectionSource = "manual" | "ai";
export type TranslationLang = "en" | "zh-Hans" | "zh-Hant";
export type TranslationMethod = "ai" | "manual";
export type UsageLimitKind = "map" | "ai" | "image";

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type PlanRow = {
  id: string;
  name: string;
  max_maps: number | null;
  max_ai_runs: number | null;
  max_image_bytes: number | null;
  price_jpy: number;
  created_at: string;
};

type ProfileRow = {
  id: string;
  email: string;
  email_confirmed: boolean;
  plan_id: string;
  is_suspended: boolean;
  created_at: string;
  updated_at: string;
};

type UsageRow = {
  profile_id: string;
  ai_runs: number;
  image_bytes: number;
  updated_at: string;
};

type MapRow = {
  id: string;
  owner_id: string;
  name: string;
  code: string;
  publish_status: PublishStatus;
  publish_start_at: string | null;
  publish_end_at: string | null;
  created_at: string;
  updated_at: string;
};

type GenreRow = {
  id: string;
  map_id: string;
  name: string;
  name_i18n: Json;
  fill_color: string;
  line_color: string;
  text_color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type BuildingRow = {
  id: string;
  map_id: string;
  code: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type FloorRow = {
  id: string;
  building_id: string;
  map_id: string;
  code: string;
  name: string;
  sort_order: number;
  image_path: string | null;
  edit_image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  created_at: string;
  updated_at: string;
};

type SectionRow = {
  id: string;
  floor_id: string;
  map_id: string;
  number: string | null;
  points: Json;
  source: SectionSource;
  created_at: string;
  updated_at: string;
};

type ShopRow = {
  id: string;
  section_id: string;
  map_id: string;
  name: string;
  genre_id: string | null;
  hours: string | null;
  description: string | null;
  image_path: string | null;
  sns_links: string[];
  created_at: string;
  updated_at: string;
};

type ShopTranslationRow = {
  shop_id: string;
  lang: TranslationLang;
  map_id: string;
  name: string | null;
  hours: string | null;
  description: string | null;
  method: TranslationMethod;
  created_at: string;
  updated_at: string;
};

type MapPublicationRow = {
  id: string;
  map_id: string;
  published_at: string;
  data: Json;
};

// map_id はトリガーで親から設定されるため、子テーブルの Insert では省略できる
export type Database = {
  public: {
    Tables: {
      plans: Table<PlanRow, PlanRow>;
      profiles: Table<ProfileRow, Pick<ProfileRow, "id" | "email"> & Partial<ProfileRow>>;
      usage: Table<UsageRow, Pick<UsageRow, "profile_id"> & Partial<UsageRow>>;
      maps: Table<MapRow, Pick<MapRow, "owner_id" | "name" | "code"> & Partial<MapRow>>;
      genres: Table<
        GenreRow,
        Pick<GenreRow, "map_id" | "name" | "fill_color" | "line_color" | "text_color"> & Partial<GenreRow>
      >;
      buildings: Table<BuildingRow, Pick<BuildingRow, "map_id" | "code" | "name"> & Partial<BuildingRow>>;
      floors: Table<FloorRow, Pick<FloorRow, "building_id" | "code" | "name"> & Partial<FloorRow>>;
      sections: Table<SectionRow, Pick<SectionRow, "floor_id" | "points"> & Partial<SectionRow>>;
      shops: Table<ShopRow, Pick<ShopRow, "section_id" | "name"> & Partial<ShopRow>>;
      shop_translations: Table<
        ShopTranslationRow,
        Pick<ShopTranslationRow, "shop_id" | "lang"> & Partial<ShopTranslationRow>
      >;
      map_publications: Table<MapPublicationRow, Pick<MapPublicationRow, "map_id" | "data"> & Partial<MapPublicationRow>>;
    };
    Views: Record<never, never>;
    Functions: {
      is_map_owner: { Args: { p_map_id: string }; Returns: boolean };
      check_usage_limit: {
        Args: { p_kind: UsageLimitKind; p_amount?: number };
        Returns: { allowed: boolean; current_value: number; limit_value: number | null }[];
      };
      create_map: { Args: { p_name: string }; Returns: string };
      refresh_image_usage: { Args: Record<never, never>; Returns: number };
      import_shops: {
        Args: { p_map_id: string; p_rows: Json };
        Returns: { created_count: number; updated_count: number }[];
      };
      set_floor_image: {
        Args: {
          p_floor_id: string;
          p_image_path: string;
          p_edit_image_path: string;
          p_width: number;
          p_height: number;
        };
        Returns: { old_image_path: string | null; old_edit_image_path: string | null }[];
      };
    };
    Enums: {
      publish_status: PublishStatus;
      section_source: SectionSource;
      translation_lang: TranslationLang;
      translation_method: TranslationMethod;
    };
    CompositeTypes: Record<never, never>;
  };
};
