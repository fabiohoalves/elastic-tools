const request = require('supertest');
const readline = require("readline");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const { Client } = require('@elastic/elasticsearch')

const URL = "http://localhost:9200"

const LIST_LIMIT = 10;

const INDEX = 'index'

const client = new Client({
    node: URL
  });  

function restoreStruct(from, to) {
    return {
        "indices": from,
        "ignore_unavailable": true,
        "include_global_state": false,              
        "rename_pattern": "(\\w+)",
        "rename_replacement": to,
        "include_aliases": false
      };
}

function aliasAddStruct(from, to){
    return {
        "actions": [
            {
                "add": {
                    "index": from,
                    "alias": to
                }
            }
        ]
    }
}

function aliasRemoveStruct(from, to){
    return {
        "actions": [
            {
                "remove": {
                    "index": from,
                    "alias": to
                }
            }
        ]
    }
}

async function deleteIndex(indexName) {
    try {
        console.log(`removing old ${indexName}`)        
        const res = await request(URL).delete(`/${indexName}/`)
        if (res.status === 200) {
            console.log(`${indexName} remove concluded`)
        }else {
            console.log(`${indexName} not found`) 
        }
    } catch (err) {
        throw new Error(`${indexName} not found`);
    }
};


async function getAllListToRestore() {
	try {
		const res = await request('http://localhost:9200')
			.get(`/_snapshot/cs-automated/_all?pretty`)

        return res.body;
	} catch (err) {
		throw err;
	}
};

async function getListofCandidatesToRestore(){
    var list = await getAllListToRestore();
    var listofCandidates = []
    size = list.snapshots.length;
    for (var i = size - LIST_LIMIT; i < size; i++){
        listofCandidates.push(list.snapshots[i]);
    }
    return listofCandidates.reverse();
}

function compare(a, b) {
    if (a[1] < b[1]){
      return -1;
    }
    if (a[1] > b[1]){
      return 1;
    }
    return 0;
}

async function getIndices(){
    const indices = []
    var data = await client.cat.indices({format: 'json'})
    data.body.forEach(element => {
        if(element.index.includes(INDEX)){
            if(element.index === INDEX){
                var match = element.index.match(`^${INDEX}`)
                if (match) {
                    indices.push(match)
                }
            }else {
                var match = element.index.match(`^${INDEX}_v([0-9]+)`)
                if (match) {
                    indices.push(match)
                }
            }
        }
    });
    return getIndicesFromAndTo(indices.sort(compare));
}

function getIndicesFromAndTo(data){
    var lastIndex = data[data.length - 1];
    var indexFrom = "";
    var indexTo = "";
    let indexNumber = 0;
    if(lastIndex.length > 1){
        indexFrom = lastIndex[0];
        indexNumber = parseInt(lastIndex[1]);
        indexTo = indexFrom.replace(indexNumber, ++indexNumber);    
    }else {
        indexFrom = lastIndex[0];
        indexTo = `${indexFrom}_v${++indexNumber}`;  
    }
    return [indexFrom, indexTo];
}

async function addIndexAlias(from, to){
    try {
        const res = await request(URL)
            .post('/_aliases')
            .set({
                'Content-Type': 'application/json',
            })
            .send(JSON.stringify(aliasAddStruct(from, to)));
        if (res.status === 200) {
            console.log(`alias ${to} was added`);
        }else {
            console.log(`error to alias of index - status: ${res.status}`);
        }
    }catch(err){
        throw new Error(`error in alias`);
    }
}

async function removeIndexAlias(from, to){
    try {
        const res = await request(URL)
            .post('/_aliases')
            .set({
                'Content-Type': 'application/json',
            })
            .send(JSON.stringify(aliasRemoveStruct(from, to)));
        if (res.status === 200) {
            console.log(`alias was concluded`);
        }else {
            console.log(`error to alias of index - status: ${res.status}`);
        }
    }catch(err){
        throw new Error(`error in alias`);
    }
}

async function restoreIndex(indexName) {
	try {        
        const [indexFrom, indexTo] = await getIndices();     
        const res = await request('http://localhost:9200')
                .post(`/_snapshot/cs-automated/${indexName}/_restore`)
                .set({
                    'Content-Type': 'application/json',
                })
                .send(JSON.stringify(restoreStruct(indexFrom, indexTo)));
        if (res.status === 200) {
            console.log(`index ${indexTo} was restored`);           
            await removeIndexAlias(indexFrom, INDEX);
            await addIndexAlias(indexTo, INDEX);
            await deleteIndex(indexFrom)
        }else{
            console.log(`error to restored the index - status: ${restored.status}`);
        }
    } catch (err) {
        throw new Error(`error to restored the index: ${indexName}`);
    }
}; 

async function main(){
    var list = await getListofCandidatesToRestore();
    for( var i = 0; i < list.length; i++) {
        var item = JSON.parse(JSON.stringify(list[i]));
        console.log(`${i} - index avaiable to restore: start_time: ${item.start_time} - end_time: ${item.end_time} - total_shards: ${item.shards.total}\n`)
    }
    rl.question('Choose the index would you like to restore? ', async index => {      
        try {
            var itemToRestore = JSON.parse(JSON.stringify(list[index]));
            await restoreIndex(itemToRestore.snapshot);            
        } catch (err) {
            throw new Error(`error to restored`);
        } finally {
            rl.close();
        }
    })
}

main();