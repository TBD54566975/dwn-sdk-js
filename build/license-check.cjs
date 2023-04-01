/*
 * use an allowlist
 */
allowedLicences = ['ISC','MIT', 'BSD', 'Apache-2.0', 'CC0-1.0'];


function main() {
  var fs = require('fs');
  var license = fs.readFileSync('license-report.json', 'utf8');

  var licenseJson = JSON.parse(license);

  for (var i = 0; i < licenseJson.length; i++) {
    var licenseType = licenseJson[i].licenseType;

    allowed = false;
    for (var j = 0; j < allowedLicences.length; j++) {
      if (licenseType === allowedLicences[j]) {
        allowed = true;
      }
      if (!allowed && licenseType.includes(allowedLicences[j])) {
        allowed = true;
      }
    }

    if (!allowed) {
      //exit with error
      console.log('Found unapproved license: ' + licenseType + '. If this is a valid license, please add it to the allowlist.');
      console.log(licenseJson[i]);
      process.exit(1);
    }

  }
}


main();