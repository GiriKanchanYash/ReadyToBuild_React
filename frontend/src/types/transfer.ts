export interface PlantGeo {
  plant_id: string;
  plant_name: string;
  plant_type: string;
  city: string;
  state: string;
  country_code: string;
  country_name: string;
  region: string;
  latitude: number;
  longitude: number;
}

export type TransportMode = 'TRUCK' | 'AIR' | 'OCEAN' | 'RAIL';

export interface Lane {
  lane_id: string;
  origin_plant_id: string;
  origin_plant_name: string;
  origin_lat: number;
  origin_lon: number;
  dest_plant_id: string;
  dest_plant_name: string;
  dest_lat: number;
  dest_lon: number;
  transport_mode: TransportMode;
  distance_km: number;
  transit_days: number;
  transit_cost_usd: number;
  cost_per_unit_usd: number;
  carrier_name: string;
  service_level: string;
  co2_kg_per_unit: number;
  reliability_pct: number;
}

export interface ShortagePart {
  part_number: string;
  part_description: string;
  dest_plant_id: string;
  dest_plant_name: string;
  required_qty: number;
  available_qty: number;
  gap_qty: number;
  earliest_need_date: string | null;
  source_plant_count: number;
  total_protectable_qty: number;
}

export interface TransferCandidateModeOption {
  transport_mode: TransportMode;
  lane_id: string;
  carrier_name: string;
  transit_days: number;
  cost_per_unit_usd: number;
  distance_km: number;
}

export interface TransferCandidate {
  origin_plant_id: string;
  origin_plant_name: string;
  origin_lat: number;
  origin_lon: number;
  origin_available_qty: number;
  origin_safety_stock: number;
  transport_mode: TransportMode;
  lane_id: string;
  carrier_name: string;
  distance_km: number;
  transit_days: number;
  cost_per_unit_usd: number;
  protectable_qty: number;
  protected_builds: number;
  score: number;
  impact_pct: number;
  all_modes: TransferCandidateModeOption[];
  // Echoed by backend
  part_number: string;
  part_description: string;
  dest_plant_id: string;
  dest_plant_name: string;
  dest_lat: number;
  dest_lon: number;
  dest_available_qty: number;
  dest_required_qty: number;
  dest_gap_qty: number;
  qty_per_assembly: number;
  earliest_need_date: string | null;
}

export interface TransferKpi {
  total_inventory: number;
  total_demand: number;
  coverage_pct: number;
  earliest_need_date: string | null;
  destination_available: number;
  gap_qty: number;
  qty_per_assembly: number;
}

export interface TransferCandidatesResponse {
  part_number: string;
  part_description: string;
  dest_plant_id: string;
  dest_plant_name: string;
  dest_lat: number;
  dest_lon: number;
  kpi: TransferKpi;
  candidates: TransferCandidate[];
}

export interface OpenStoRow {
  sto_id: string;
  sto_line_id: string;
  origin_plant_id: string;
  origin_plant_name: string;
  dest_plant_id: string;
  dest_plant_name: string;
  part_number: string;
  part_description: string;
  qty_requested: number;
  qty_shipped: number;
  qty_in_transit: number;
  qty_received: number;
  transport_mode: TransportMode;
  carrier_name: string;
  transit_days: number;
  unit_transfer_cost: number;
  total_transfer_cost: number;
  sto_status: string;
  reason_code: string;
  requested_delivery_date: string | null;
  expected_arrival_date: string | null;
  requested_by: string;
}
