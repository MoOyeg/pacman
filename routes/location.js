//code adapted to run with external metadata service -- https://github.com/MoOyeg/kubernetes-cloud-metadata-tool
var http = require('http');
var https = require('https');
var express = require('express');
var router = express.Router();
var fs = require('fs');
var os = require('os');

// middleware that is specific to this router
router.use(function timeLog(req, res, next) {
    console.log('Time: ', Date());
    next();
})

router.get('/metadata', function(req, res, next) {
    console.log('[GET /loc/metadata]');
    var h = getHost();
    getCloudMetadata(function(c, z) {
        console.log(`CLOUD: ${c}`);
        console.log(`ZONE: ${z}`);
        console.log(`HOST: ${h}`);
        res.json({
            cloud: c,
            zone: z,
            host: h
        });
    });
});

function getCloudMetadata(callback) {
    console.log('getCloudMetadata');
    // Query k8s node api
    getK8sCloudMetadata(function(err, c, z) {
        if (err) {
            // Try AWS next
            console.log('Could not get CloudMetadata');
        } else {
            callback(c, z); // Running against k8s api
        }
    });
}

function getK8sCloudMetadata(callback) {
    console.log('getK8sCloudMetadata');
    // Set options to retrieve k8s api information
    var node_name = process.env.METADATA_NODE_NAME;
    var node_port = process.env.METADATA_NODE_PORT
    console.log('Querying Cloud Metadata Service at ' + node_name + ' and port ' + node_port + 'for cloud data');

    var genericOptions = {
        host: `${node_name}`,
        port: `${node_port}`,
        path: `/metadata`,
        timeout: 10000,
    };
 
    var cloudName = 'unknown',
        zone = 'unknown';

    var req = https.request(genericOptions, (zoneRes) => {
        let error;

        if (zoneRes.statusCode !== 200) {
            error = new Error(`Request Failed.\n` +
                `Status Code: ${zoneRes.statusCode}`);
        }

        if (error) {
            console.log(error.message);
            // consume response data to free up memory
            zoneRes.resume();
            callback(error, cloudName, zone);
            return;
        }
// Sample Response {"CLOUD_PROVIDER":"aws","CLOUD_REGION":"us-east-1","CLOUD_AVAILIBILITY_ZONE":"us-east-1a","CLOUD_INSTANCE_TYPE":"c5.4xlarge","HOSTNAME":"ip-10-0-138-120.ec2.internal"}
        console.log(`STATUS: ${zoneRes.statusCode}`);
        console.log(`HEADERS: ${JSON.stringify(zoneRes.headers)}`);
        zoneRes.setEncoding('utf8');

        var body = [];

        zoneRes.on('data', (chunk) => {
            body.push(chunk);
        });
        zoneRes.on('end', () => {
            var metaData = JSON.parse(body.join(''));
            console.log(`RESULT: ${metaData}`);
            console.log('No more data in response.');

            if (metaData.spec.providerID) {
                var provider = metaData.spec.providerID;
                cloudName = String(provider.split(":", 1)); // Split on providerID if request was successful
            }

            // use the annotation  to identify the zone if available
            if (metaData.metadata.labels['failure-domain.beta.kubernetes.io/zone']) {
                zone = metaData.metadata.labels['failure-domain.beta.kubernetes.io/zone'].toLowerCase();

            }
            // return CLOUD and ZONE data
            if (cloudName == "unknown") {
                error = new Error(`CloudName not found on node Spec`);
                console.log(error);
                callback(error, cloudName, zone);
            }
            else {
                console.log(`CLOUD: ${cloudName}`);
                console.log(`ZONE: ${zone}`);
                callback(null, cloudName, zone);
            }
        });

    });

    req.on('error', (e) => {
        console.log(`problem with request: ${e.message}`);
        // return CLOUD and ZONE data
        callback(e, cloudName, zone);
    });

    // End request
    req.end();
}

function getHost() {
    console.log('[getHost]');
    var host = os.hostname();
    console.log(`HOST: ${host}`);
    return host;
}

module.exports = router;
