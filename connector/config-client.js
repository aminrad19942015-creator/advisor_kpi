function configUrl(){
  const shadowUrl=process.env.DASHBOARD_API_URL||'https://advisor-kpi.vercel.app/api/crm-shadow';
  return process.env.DASHBOARD_CRM_CONFIG_URL||shadowUrl.replace(/\/crm-shadow\/?$/,'/crm-config');
}

async function loadCrmConfig(connectorToken){
  const url=configUrl();
  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const r=await fetch(url,{
        method:'GET',
        headers:{'x-crm-connector-token':connectorToken},
        signal:AbortSignal.timeout(30000)
      });
      const text=await r.text();
      if(!r.ok) throw new Error('CRM config HTTP '+r.status+': '+text);
      const j=JSON.parse(text);
      if(!j.ok||!j.config) throw new Error(j.error||'CRM config response is invalid.');
      return j.config;
    }catch(e){
      lastError=e;
      if(attempt<3) await new Promise(resolve=>setTimeout(resolve,750*attempt));
    }
  }
  throw lastError;
}

module.exports={loadCrmConfig};
