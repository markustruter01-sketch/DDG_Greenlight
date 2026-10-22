export function homeRig(fovy: number): { target: number[]; az: number; el: number; dist: number };
export function rigPose(rig: any, lon: number, o?: { radiusM?: number }): { position: number[]; direction: number[]; up: number[] };
export function rigFromPosition(position: number[], lon: number, target: number[]): { target: number[]; az: number; el: number; dist: number };
export function interpolateRig(a: any, b: any, t: number, options?: { lift?: number }): { target: number[]; az: number; el: number; dist: number };
