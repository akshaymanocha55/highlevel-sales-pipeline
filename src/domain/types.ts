export const STAGES = ['new', 'contacted', 'demo', 'proposal', 'negotiation', 'won', 'lost'] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  new: 'New Lead',
  contacted: 'Contacted',
  demo: 'Demo Done',
  proposal: 'Proposal Sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

export const OPEN_STAGES: Stage[] = ['new', 'contacted', 'demo', 'proposal', 'negotiation'];

export const isOpen = (s: Stage) => s !== 'won' && s !== 'lost';

export interface Deal {
  id: string;
  company: string;
  /** lowercased company, precomputed for fast search */
  companyLc: string;
  licences: number;
  /** deal value in rupees */
  value: number;
  owner: string;
  stage: Stage;
  lastActivityAt: number;
  /** expected close date (ms) */
  closeDate: number;
  /** incremented by the server on every change */
  version: number;
  updatedBy: string;
  updatedAt: number;
}

/** A change pushed by the server because a teammate edited a deal. */
export interface RemoteChange {
  deal: Deal;
  /** what the teammate did, for display */
  summary: string;
}

export interface MoveOp {
  id: string;
  toStage: Stage;
  /** version + stage the client based this move on (version is unknown for rows never loaded) */
  baseVersion?: number;
  baseStage: Stage;
  /** skip conflict detection ("keep mine") */
  force?: boolean;
}

export type MoveResult =
  | { id: string; status: 'ok'; deal: Deal }
  | { id: string; status: 'conflict'; deal: Deal }
  | { id: string; status: 'not_found' };
