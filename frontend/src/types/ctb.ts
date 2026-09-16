export interface KpiData {
  total_work_orders: number;
  ready_count: number;
  partial_count: number;
  blocked_count: number;
  can_build_units: number;
  shortage_parts: number;
}

export interface StatusDistribution {
  status: string;
  count: number;
}

export interface TopShortage {
  part_number: string;
  shortage_qty: number;
  affected_orders: number;
}

export interface PriorityBreakdown {
  PRIORITY: number;
  ready: number;
  partial: number;
  blocked: number;
}

export interface WorkOrder {
  WORK_ORDER_ID: string;
  PRODUCT_ID: string;
  PLANT_ID: string;
  PLANNED_QTY: number;
  PRIORITY: number;
  WORK_ORDER_STATUS: string;
  planned_start_date: string;
  ctb_status: string;
  can_build_qty: number;
  requested_qty: number;
}

export interface PartDetail {
  part_number: string;
  qty_per_assembly: number;
  required_qty: number;
  available_qty: number;
  safety_stock: number;
  incoming_qty: number;
  part_status: string;
}

export interface WorkOrderDetail extends WorkOrder {
  WORK_ORDER_TYPE: string;
  planned_end_date: string;
  production_status: string;
  parts: PartDetail[];
  weekly_build_sequence?: WeeklyBuildSequenceRow[];
  weekly_build_summary?: Record<string, WeeklyBuildSummary>;
}

export interface WeeklyBuildSummary {
  planned_qty: number;
  week_can_build: number;
  week_status: 'READY' | 'PARTIAL' | 'BLOCKED';
  part_count: number;
  shortage_count: number;
  partial_count: number;
  safety_count: number;
}

export interface WeeklyBuildSequenceRow {
  build_week: number;
  build_stage: string;
  part_number: string;
  description: string;
  qty_per_unit: number;
  planned_qty: number;
  on_hand: number;
  safety_stock: number;
  deliveries: number;
  hp_used: number;
  eff_avail_qty: number;
  qty_required: number;
  can_build: number;
  status: string;
}

export interface BomNode {
  ROOT_PRODUCT: string;
  PARENT_PART_NUMBER: string;
  CHILD_PART_NUMBER: string;
  CHILD_PART_DESCRIPTION: string;
  CHILD_PART_TYPE: string;
  QTY_PER_ASSEMBLY: number;
  EXTENDED_QTY: number;
  BOM_LEVEL: number;
  BOM_PATH: string;
}

export interface BomStats {
  max_depth: number;
  total_parts: number;
  low_inv_cnt: number;
  total_qty_needed: number;
}

export interface BomLineageRow {
  PARENT_PART_NUMBER: string;
  CHILD_PART_NUMBER: string;
  CHILD_PART_DESCRIPTION: string;
  QTY_PER_ASSEMBLY: number;
  LEVEL: number;
  QTY_AVAILABLE: number;
  SAFETY_STOCK: number;
  HP_ALLOCATED: number;
  EFF_AVAILABLE: number;
  /** Extended BOM need × planned WO qty (for shortage vs inventory). */
  BUILD_NEED_QTY?: number;
}

export interface BomWhereUsedRow {
  PRODUCT: string;
  BOM_LEVEL: number;
  QTY_PER_UNIT: number;
  WORK_ORDERS: number;
  TOTAL_REQUIRED: number;
  AVAILABLE: number;
  GAP: number;
}

export interface BomOpenPoRow {
  PO_ID: string;
  SUPPLIER: string;
  QTY_ORDERED: number;
  QTY_OUTSTANDING: number;
  CONFIRMED_DELIVERY_DATE: string;
  PO_STATUS: string;
}

export interface ShortageAlert {
  PART_NUMBER: string;
  WORK_ORDER_ID: string;
  PLANT_ID: string;
  SHORTAGE_QTY: number;
  ALERT_STATUS: string;
  PRODUCT_ID: string;
  PRIORITY: number;
  planned_start_date: string;
}

export interface FilterOptions {
  products: string[];
  plants: Array<string | { id: string; name: string }>;
  weeks: string[];
}

export type ProductionLane = 'HIGH_PRIORITY' | 'IN_PRODUCTION' | 'YET_TO_START' | 'NEXT_WEEK' | 'OTHER';

export interface ProductionBoardItem {
  WORK_ORDER_ID: string;
  PRODUCT_ID: string;
  PLANT_ID: string;
  PRIORITY: number;
  PLANNED_QTY: number;
  planned_start_date: string;
  WORK_ORDER_STATUS: string;
  ctb_status: string;
  planning_status: 'READY_NOW' | 'READY_ON_DELIVERY' | 'PARTIAL' | 'BLOCKED';
  production_status: string;
  can_build_qty: number;
  parts_ready_now: number;
  parts_ready_with_del: number;
  total_parts: number;
  week_start: string;
  lane: ProductionLane;
}

export type ConstraintSeverity = 'CRITICAL' | 'HIGH' | 'MODERATE';

export interface BomConstraint {
  WORK_ORDER_ID: string;
  PRODUCT_ID: string;
  PRIORITY: number;
  PLANNED_QTY: number;
  planned_start_date: string;
  constraint_part: string;
  BOM_LEVEL: number;
  qty_per_unit: number;
  required_qty: number;
  available_qty: number;
  safety_stock: number;
  total_deliveries: number;
  gap: number;
  severity: ConstraintSeverity;
}

export interface PartInventoryRow {
  part_number: string;
  description: string;
  inv: number;
  ss: number;
  week_label: string;   // MM/DD
  week_start: string;   // YYYY-MM-DD
  balance: number;
  has_delivery: 0 | 1;
  using_safety: 0 | 1;
  /** 1 in the week to place a PO: first projected shortage/safety breach minus supplier lead time (not WO priority). */
  suggest_reorder?: 0 | 1;
}

export interface PrioritizationSimRow {
  part_number: string;
  required_qty: number;
  planned_qty: number;
  wo_can_build_qty: number;
  wo_ctb_status: string;
  total_inventory: number;
  incoming_qty: number;
  in_production_reserved: number;
  high_priority_reserved: number;
  available_now: number;
  available_after_delivery: number;
  shortage_now: number;
  shortage_after_delivery: number;
  part_status: string;
  can_build_now: number;
  can_build_after_delivery: number;
}

export interface PrioritizationImpactRow {
  WORK_ORDER_ID: string;
  PRODUCT_ID: string;
  PRIORITY: number;
  PLANNED_QTY: number;
  planned_start_date: string;
  work_order_status: string;
  current_can_build: number;
  current_status: string;
  new_can_build: number;
  lost_build_qty: number;
  shared_parts: string;
  shared_part_count: number;
}
