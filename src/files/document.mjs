// File-body downloads share the controller/test-run lifecycle and have a hard
// deadline. A metadata size is only a hint; browse checks actual streamed bytes.
export function createDocumentFetcher({telegram,fetch=globalThis.fetch,signal}){
  return async(botId,document,{maxBytes=Infinity}={})=>{
    const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
    requestSignal.throwIfAborted();
    const file=await telegram.call(botId,'getFile',{file_id:document.file_id},{signal:requestSignal});
    const response=await fetch(`https://api.telegram.org/file/bot${await telegram.getToken(botId)}/${file.file_path}`,{signal:requestSignal});
    if(!response.ok)throw new Error('Document download failed.');
    if(Number(response.headers?.get('content-length'))>maxBytes){await response.body?.cancel();throw new Error('Document exceeds the download byte limit.');}
    if(!response.body?.[Symbol.asyncIterator]){
      const bytes=Buffer.from(await response.arrayBuffer());requestSignal.throwIfAborted();if(bytes.length>maxBytes)throw new Error('Document exceeds the download byte limit.');return bytes;
    }
    const chunks=[];let size=0;
    for await(const chunk of response.body){requestSignal.throwIfAborted();size+=chunk.length;if(size>maxBytes)throw new Error('Document exceeds the download byte limit.');chunks.push(chunk);}
    requestSignal.throwIfAborted();return Buffer.concat(chunks,size);
  };
}
