import { getMeta, getTeamSummary, getTeamFilterOptions, getOpenFilterOptions, getOpenSummary } from './dashboard.ts';

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

export async function getDashboardInitialPayload(openFilters:any={}){
  const started=Date.now();
  const [meta,team,teamFilters,openFiltersOptions,open]=await Promise.all([
    getMeta(),
    getTeamSummary({}),
    getTeamFilterOptions(),
    getOpenFilterOptions(),
    getOpenSummary(openFilters||{})
  ]);

  return {
    meta:{...meta,durationSeconds:Math.round((Date.now()-started)/100)/10},
    team,
    open,
    teamFilters,
    openFilters:openFiltersOptions,
    daily:null,
    weekly:null,
    monthly:null
  };
}
