import { getMeta, getTeamSummary, getOpenSummary } from './dashboard';

export async function getDashboardBootstrap(){
 const started=Date.now();
 const [meta,team,open]=await Promise.all([
  getMeta(),getTeamSummary({}),getOpenSummary({})
 ]);
 return {
  meta:{...meta,durationSeconds:Math.round((Date.now()-started)/100)/10},
  team,
  open,
  daily:null,
  weekly:null,
  monthly:null
 };
}
