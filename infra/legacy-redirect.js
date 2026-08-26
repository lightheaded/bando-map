// Viewer-request function on the retired bando.toom.as distribution.
//
// Every request is answered here with a permanent redirect to the live
// address; the S3 origin behind this distribution is never reached, and the
// bucket policy does not grant it, so a broken function returns 403 rather
// than quietly serving the site from the old name.
//
// ${target} is substituted by terraform (templatefile in main.tf).
function handler(event) {
  var request = event.request
  var query = ''

  for (var key in request.querystring) {
    var values = request.querystring[key].multiValue || [request.querystring[key]]
    for (var i = 0; i < values.length; i++) {
      query += (query ? '&' : '?') + key
      if (values[i].value) query += '=' + values[i].value
    }
  }

  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: 'https://${target}' + request.uri + query },
      // An hour, not a year: a permanent redirect that browsers pin forever is
      // very hard to take back if the target ever moves again.
      'cache-control': { value: 'max-age=3600' },
    },
  }
}
