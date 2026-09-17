import c0 from '../../lib/ui/css-00';
import c1 from '../../lib/ui/css-01';
import c2 from '../../lib/ui/css-02';
import c3 from '../../lib/ui/css-03';
import c4 from '../../lib/ui/css-04';
import c5 from '../../lib/ui/css-05';
import c6 from '../../lib/ui/css-06';

export const dynamic='force-static';

export function GET(){
 return new Response([c0,c1,c2,c3,c4,c5,c6].join(''),{
  headers:{'content-type':'text/css; charset=utf-8','cache-control':'public, max-age=31536000, immutable'}
 });
}
