export class ApiError extends Error { constructor(message:string, public status=0) {super(message);} }
export async function request<T>(base:string,path:string,init:RequestInit={},transport:typeof fetch=fetch):Promise<T> {
 const method=init.method??'GET';
 for(let attempt=0;;attempt++) {
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
 try { const response=await transport(base.replace(/\/$/,'')+path,{...init,signal:controller.signal,headers:{'Content-Type':'application/json',...init.headers}});
 const data=await response.json().catch(()=>null);
 if(!response.ok) throw new ApiError(Array.isArray(data?.message)?data.message.join('. '):(data?.message??`Error HTTP ${response.status}`),response.status);
 return data as T;
 } catch(e) { if(method==='GET'&&attempt===0&&!(e instanceof ApiError)) continue; if(e instanceof ApiError)throw e; throw new ApiError('Sin conexión o tiempo agotado. Verificá WiFi y API. No se guardan ventas offline.'); }
 finally {clearTimeout(timer);} }
}
