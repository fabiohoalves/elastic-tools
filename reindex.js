
const request = require('supertest');
const { Client } = require('@elastic/elasticsearch')

const URL = "http://localhost:9200";

const INDEX = 'index';

const client = new Client({
  node: URL
});

const MAPPING = require('./mapping.json');

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
    return indices.sort(compare);
}


function reindexStruct(from, to) {
    return { 
        "source": {
            "index": from
        },
        "dest": {
            "index": to
        }
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

async function reindex(from, to) {
    try {
        const res = await request(URL)
            .post('/_reindex?wait_for_completion=true')
            .set({
                'Content-Type': 'application/json',
            })
            .send(JSON.stringify(reindexStruct(from, to)));
        if (res.status === 200) {
            console.log(`reindex was concluded`);
        }else {
            console.log(`error to reindex the index - status: ${res.status}`);
        }
    }catch(err){
        throw new Error(`error in reindex`);
    }
};

async function deleteIndex(indexName){
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
}

async function createIndex(indexName) {
    try {
        console.log(`creating ${indexName}`)        
        const res = await request(URL)
        .put(`/${indexName}?pretty`)
        .set({
            'Content-Type': 'application/json',
        })
        .send(JSON.stringify(MAPPING));
        if (res.status === 200) {
            console.log(`${indexName} create concluded`)
        }else {
            console.log(`${indexName} not found`) 
        }
    } catch (err) {
        console.log(err)
        throw new Error(`${err}`);
    }
}; 

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

function main(){
    getIndices().then(async data => {
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
        await createIndex(indexTo);
        await reindex(indexFrom, indexTo);
        await removeIndexAlias(indexFrom, INDEX);
        await addIndexAlias(indexTo, INDEX);
        await deleteIndex(indexFrom)
    });
}

main()