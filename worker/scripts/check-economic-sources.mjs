// Read-only network check. Uses no Cloudflare credentials and never writes KV.
import {SOURCES,PARSERS,fetchSource,normalizeRows} from '../src/services/economic-events.js';
let failed=false;
for(const [source,url] of Object.entries(SOURCES)){
  try{
    const rows=normalizeRows(PARSERS[source](await fetchSource(url)));
    console.log(JSON.stringify({source,upcoming:rows.length,first:rows[0]||null}));
    if(!rows.length)failed=true;
  }catch(error){failed=true;console.error(JSON.stringify({source,error:error.message}));}
}
if(failed)process.exitCode=1;
