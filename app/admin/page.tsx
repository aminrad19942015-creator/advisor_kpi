import AdminClient from './AdminClient';
import { isAdmin } from '../../lib/admin-auth';
import { getMeta } from '../../lib/dashboard';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const revalidate=0;
export default async function AdminPage(){
 const authenticated=await isAdmin().catch(()=>false);
 const meta=authenticated?await getMeta().catch(()=>({dataVersion:'',lastSyncAt:''})):{dataVersion:'',lastSyncAt:''};
 return <AdminClient authenticated={authenticated} lastSyncAt={String((meta as any).lastSyncAt||'')} dataVersion={String((meta as any).dataVersion||'')}/>;
}
