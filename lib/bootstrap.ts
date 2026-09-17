import { getMeta, getTeamSummary, getOpenSummary } from './dashboard';
import { getFilteredPeriodSummary } from './period';

export async function getDashboardBootstrap(){
 const started=Date.now();
 const [meta,team,open,daily,weekly,monthly]=await Promise.all([
  getMeta(),getTeamSummary({}),getOpenSummary({}),getFilteredPeriodSummary('daily',{}),getFilteredPeriodSummary('weekly',{}),getFilteredPeriodSummary('monthly',{})
 ]);
 return {meta:{...meta,durationSeconds:Math.round((Date.now()-started)/100)/10},team,open,daily,weekly,monthly};
}
