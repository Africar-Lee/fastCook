export type LocalizedText = Readonly<Record<string, string>>;
export type ReviewState = 'pending_review' | 'reviewed' | 'rejected';
export type Importance = 'required' | 'important' | 'optional';
export type SubstitutionLevel = 'equivalent' | 'acceptable' | 'poor';
export type Course = 'meat' | 'veg' | 'soup' | 'staple' | 'cold';
export type CookingMethod = 'stir_fry' | 'pan_fry' | 'deep_fry' | 'boil' | 'steam' | 'braise' | 'roast' | 'cold_mix' | 'mixed';
export type Equipment = 'wok' | 'frying_pan' | 'pot' | 'steamer' | 'oven' | 'air_fryer' | 'rice_cooker' | 'microwave' | 'pressure_cooker' | 'electric_steamer';
export type Quantity = Readonly<{ unit: string; value?: number; min?: number; max?: number; spoon_standard?: string }>;
export type Ingredient = Readonly<{
  ingredient_id: string;
  names: LocalizedText;
  aliases: Readonly<Record<string, readonly Readonly<{ text: string; resolution: 'automatic' | 'needs_confirmation' }>[]>>;
  selectable: boolean;
  matching_parent_ids: readonly string[];
  implicit_staple: boolean;
  review_state: ReviewState;
}>;
export type Step = Readonly<{ step_id: string; text: LocalizedText; requirement_ids: readonly string[] }>;
export type ExecutionStep = Step & Readonly<{
  substitutions: readonly Readonly<{
    requirement_id: string;
    original_ingredient_id: string;
    used_ingredient_id: string;
    rule_id: string;
    recipe_quantity?: Quantity;
    usage_note: LocalizedText;
  }>[];
}>;
export type StepChange = Readonly<{ step_id: string; action: 'skip' }> | Readonly<{ step_id: string; action: 'replace'; text: LocalizedText; requirement_ids: readonly string[] }>;
export type Requirement = Readonly<{
  requirement_id: string;
  ingredient_id: string;
  importance: Importance;
  role: 'main' | 'secondary' | 'seasoning' | 'garnish';
  consumes: boolean;
  quantity: Quantity;
  omission?: Readonly<{ note: LocalizedText; step_changes: readonly StepChange[] }>;
}>;
export type SubstitutionOverride = Readonly<{
  requirement_id: string;
  rule_id: string;
  action: 'allow' | 'forbid';
  note: LocalizedText;
  step_changes?: readonly StepChange[];
}>;
export type Recipe = Readonly<{
  recipe_id: string;
  dish_id: string;
  name: LocalizedText;
  course: Course;
  cooking_method: CookingMethod;
  time_minutes: number;
  spicy_level: number;
  equipment_slots: readonly Readonly<{ equipment: Equipment; minutes: number; burner_slots: number }>[];
  requirements: readonly Requirement[];
  steps: readonly Step[];
  substitution_overrides: readonly SubstitutionOverride[];
  review_state: ReviewState;
}>;
export type SubstitutionRule = Readonly<{
  rule_id: string;
  scope: 'global' | 'recipe';
  recipe_id?: string;
  required_ingredient_id: string;
  substitute_ingredient_id: string;
  level: SubstitutionLevel;
  conditions: Readonly<{
    cooking_methods: readonly CookingMethod[];
    requires_available_ingredient_ids: readonly string[];
    requires_confirmation: boolean;
  }>;
  quantity_ratio?: Readonly<{ required_unit: string; substitute_unit: string; factor: number }>;
  usage_note: LocalizedText;
  step_policy: 'ingredient_replacement_only' | 'recipe_step_changes_required';
  review_state: ReviewState;
}>;
export type Catalog = Readonly<{
  schema_version: string;
  dataset_version: string;
  release_state: 'draft' | 'release_candidate' | 'published';
  default_locale: string;
  ingredients: readonly Ingredient[];
  dishes: readonly Readonly<{ dish_id: string }>[];
  recipes: readonly Recipe[];
  substitution_rules: readonly SubstitutionRule[];
}>;
export type EngineError = Readonly<{ code: string; path: string; message: string }>;
export type Result<T> = { data: T; error: null } | { data: null; error: EngineError };
export type InventoryItem = Readonly<{ item_id: string; ingredient_id: string; location: 'current' | 'pantry' | 'implicit' }>;
export type EngineInput = Readonly<{
  inventory: Readonly<{
    items: readonly (InventoryItem & Readonly<{ location: 'current' | 'pantry' }>)[];
    unavailable_ingredient_ids?: readonly string[];
    use_implicit_staples?: boolean;
    equipment?: Readonly<{ available: readonly Equipment[]; unavailable: readonly Equipment[] }>;
  }>;
  filters?: Readonly<{ max_time_minutes?: number; max_spicy_level?: number; courses?: readonly Course[] }>;
  confirmations?: readonly string[];
}>;
export type InventorySnapshot = Readonly<{
  items: readonly InventoryItem[];
  unavailable: ReadonlySet<string>;
  availableEquipment: ReadonlySet<Equipment>;
  unavailableEquipment: ReadonlySet<Equipment>;
  signature: string;
}>;
export type PreparedCatalog = Readonly<{
  catalog: Catalog;
  ingredients: ReadonlyMap<string, Ingredient>;
  ancestors: ReadonlyMap<string, ReadonlySet<string>>;
  rulesByTarget: ReadonlyMap<string, readonly SubstitutionRule[]>;
}>;
export type Tier = 'ready' | 'caveat' | 'needs_confirmation' | 'one_missing' | 'insufficient';
export type RequirementMatch = Readonly<{
  requirement_id: string;
  ingredient_id: string;
  importance: Importance;
  presence: 'present' | 'missing' | 'uncertain';
  match_kind: 'exact' | 'approved_descendant' | 'implicit' | 'substitution' | 'generic' | 'none';
  omitted: boolean;
  inventory_item_id?: string;
  used_ingredient_id?: string;
  rule_id?: string;
  substitution_level?: SubstitutionLevel;
  quantity?: Quantity;
  note?: LocalizedText;
  confirmation_key?: string;
  reason_code: string;
  reason_params: Readonly<Record<string, string | readonly string[]>>;
}>;
export type RecipeEvaluation = Readonly<{
  recipe_id: string;
  dish_id: string;
  tier: Tier;
  requirements: readonly RequirementMatch[];
  steps: readonly ExecutionStep[];
  plan_valid: boolean;
  plan_error?: EngineError;
  missing_required_ingredient_ids: readonly string[];
  uncertain_requirement_ids: readonly string[];
  missing_equipment: readonly Equipment[];
  uncertain_equipment: readonly Equipment[];
  important_gap_count: number;
  uncertain_required_count: number;
  substitution_counts: Readonly<Record<SubstitutionLevel, number>>;
  used_inventory_item_ids: readonly string[];
  current_ingredient_count: number;
  time_minutes: number;
  buy_ingredient_ids: readonly string[];
}>;
export type PurchaseSuggestion = Readonly<{ ingredient_id: string; dish_ids: readonly string[]; new_dish_count: number }>;
export type Recommendations = Readonly<{
  dataset_version: string;
  inventory_signature: string;
  data_status: Catalog['release_state'];
  quantity_scope: 'ingredient_kinds_only';
  dishes: readonly RecipeEvaluation[];
  purchases: readonly PurchaseSuggestion[];
}>;
export type NameResolution = Readonly<{ status: 'resolved' | 'needs_confirmation' | 'not_found'; ingredient_ids: readonly string[] }>;
