import j0 from '../../lib/ui/js-00';
import j1 from '../../lib/ui/js-01';
import j2 from '../../lib/ui/js-02';
import j3 from '../../lib/ui/js-03';
import j4 from '../../lib/ui/js-04';
import j5 from '../../lib/ui/js-05';
import j6 from '../../lib/ui/js-06';

export const dynamic='force-static';

export function GET(){
 return new Response([j0,j1,j2,j3,j4,j5,j6].join(''),{
  headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'public, max-age=31536000, immutable'}
 });
}
