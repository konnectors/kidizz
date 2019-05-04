/* SET DEBUG ENVIRONEMNT VARIABLE TO FALSE TO AVOID LOGS FROM THE EXIF LIB */
process.env['DEBUG'] = true

/* GLOBALS */
const Promise = require('bluebird')
const path = require('path')
const Readable = require('stream').Readable
const moment = require('moment')
const ExifImage = require('exif').ExifImage
var {
  BaseKonnector,
  requestFactory,
  log,
  cozyClient
} = require('cozy-konnector-libs')

const CTXT = {} // persists the context throug the run
/*
CTXT = {
  fields : fields,
  children : [
    {
      news:[]
      id,
      firstname,
      lastname,
      birthday,
      avatar_url,
      ... from the api
    }
  ]


}

 */

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {

  CTXT.fields = fields
  const accData = this.getAccountData()
  console.log(accData);
  if (!accData.history) {
    CTXT.history = []
  }else {
    CTXT.history = accData.history
  }

  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of news')
  await retrieveNews()
  log('info', 'News successfully retrieved')

  log('info', 'Fetching the photos')
  await retrievePhotos()
  log('info', 'Photos successfully retrieved')

  log('info', 'Save Account DATA...')
  console.log('account data saved are :');
  console.log(CTXT.history);
  await this.saveAccountData({history: CTXT.history}, {merge:false}) // quid de secret ?
  log('info', 'Account DATA saved')

}

/*******************************************************
AUTHENTICATION
TODO : store the response cookie to be reused on next run
********************************************************/
function authenticate(login, password) {
  return requestFactory({
    json    : true ,
    cheerio : false,
    jar     : true ,
  })
    .post({
      uri: 'https://api.kidizz.com/accounts/sign_in',
      body: { account: { email: login, password: password, remember_me: 1 } },
      headers: {
        Connection: 'Keep-Alive',
        Host: 'api.kidizz.com',
        Accept: 'application/vnd.kidizz.api+json, application/json;q=0.9',
        'cache-control': 'no-cache',
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json; charset=UTF-8',
        'X-API-Version': '1.0.1',
        'User-Agent': 'Kidizz Android (com.kidizz.KidizzApp)/2.5.7'
      }
    })
    .then(res => {
      // retrieve children list
      CTXT.children = res.user.children
      CTXT.children.forEach(child => (child.news = []))
    })
    .catch(err => {
      log('error', err.message)
    })
}


/*******************************************************
RETRIEVE NEWS for each child (of the user's account)
They are stored in CTXT.children[i].news
********************************************************/
function retrieveNews() {
  const promises = []
  for (let child of CTXT.children) {
    promises.push(retrieveNews_rec(1, child))
  }
  return Promise.all(promises)
}

function retrieveNews_rec(page, child) {
  return requestFactory({json: true, cheerio: false, jar: true})
    .get({
      qs: { current_child: child.id, page: page },
      uri: 'https://api.kidizz.com/activities',
      headers: {
        Connection: 'Keep-Alive',
        Host: 'api.kidizz.com',
        Accept: 'application/vnd.kidizz.api+json, application/json;q=0.9',
        'cache-control': 'no-cache',
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json; charset=UTF-8',
        'X-API-Version': '1.0.1',
        'User-Agent': 'Kidizz Android (com.kidizz.KidizzApp)/2.5.7'
      }
    })
    .then(news => {
      if (news.length === 0) return true
      //concat all the news pages into CTXT.children[i].news
      child.news = child.news.concat(news)
      return retrieveNews_rec(page + 1, child)
    })
    .catch(err => {
      log('error', err)
    })
}

/*******************************************************
RETRIEVE PHOTOS for each child
********************************************************/
function retrievePhotos() {
  const promises = []
  for (let child of CTXT.children) {
    promises.push(retrievePhotos_rec(child))
  }
  return Promise.all(promises)
}

async function retrievePhotos_rec(child) {
  let photosList = []
  child.news = child.news.slice(0,1) // TODO remove, just for tests
  for (let news of child.news) {
    // check the post has some photo
    if (!(news.post && news.post.images)) continue
    for (let img of news.post.images) {
      // check the image has not already been downloded
      if (await isPhotoAlreadyInCozy(img.id)) continue
      let url = img.url
      url = path.dirname(url) + '/' + path.basename(url).replace(/^nc1000_/, '')
      let photo = {
        url     : url                         ,
        newsDate: moment(news.post.created_at),
        child   : child                       ,
        kidizzId: img.id                      ,
      }
      photosList.push(photo)
    }
  }
    /*--------------------------------------------------*/
    /* FOR DEBUG, limit the number of photo to download */
    /* uncomment the relevant line                      */
    photosList = photosList.slice(0,1)
    // photosList = [ photosList[0], {
    //     "url": "https://d131x7vzzf85jg.cloudfront.net/upload/images/image/dc/d5/14/00/IMG_0518_fea2.JPG?Expires=1555948544&Signature=AsOqDi2klpWUGEBPRW21X5WqIZ0Ise1uTHr3veRWPtNpk~DBuCNJvVBqvGbK9JD0bRBHOnEZeLL1TCmp0EMdVAuOHK-bw0M0TCOQQg7Xwc6UyH3UUA4wjnYJmyWvTABBi1JFUZfwUxHZx0ocKVwpdaco7TLAVmQopxruxuz1yXbXav3mas7xQTSp8mt-zJO15-Csnx7Y-HERbgQr167AVHj4rzrFo4j3aShlthfynHHvmjLgaEjiykOjhhqF~wMnSGI97F2l7xql0eLfQ6M4tLb0pqfls-dpEEENF6006~geiVtcbZZWhIkv0X9Kl9RPgTmIHUaNA4SXWMSsgq7i~w__&Key-Pair-Id=E210DR96H5WSKY",
    //     "newsDate": moment("2019-04-19T14:10:04.000Z")
    //   }]
    // require('fs').writeFileSync('log.json', JSON.stringify(photosList))
    /*--------------------------------------------------*/

  return Promise.map(photosList, photo => getPhoto(photo), { concurrency: 10 })
}

async function isPhotoAlreadyInCozy(kidizzPhotoId) {
  const {history} = CTXT  // TODO full history cycle to be tested

  console.log('\n', kidizzPhotoId);
  const existingImg = history.find(img=> {return img.kidizzId === kidizzPhotoId} )
  if (!existingImg) console.log("photo doesn't exists in history", kidizzPhotoId); return false

  const existingImgDoc = await cozyClient.files.statById(existingImg.cozyId) // TODO to be tested in dev mode (when getAccoundData will work)
  .then(()=>console.log('TRRRRRRRUEEEEEEEE'))
  .catch(err=>{
    console.log('ARRRRTUNG file is not in cozy', existingImg.cozyId);
    return false
  })

  console.log(existingImgDoc)

  if (!existingImgDoc) console.log('photo exists in history but NOT in Cozy'); return false

  console.log('test photo exists in history AND in Cozy', true);
  return true
}

function getPhoto(photo) {
  return requestFactory({json: true, cheerio: false, jar: true})
    .get({
      uri                    : photo.url                       ,
      encoding               : null                            ,
      headers                : { 'cache-control': 'no-cache' } ,
      resolveWithFullResponse: true                            ,
    })
    .then(resp => {
      photo.body     = resp.body
      photo.filename = path.basename(photo.url).replace(/\?.*/, '')
      photo.ext      = photo.filename.toLowerCase().match(/[\w]*$/)[0]
      photo.mimeType = 'image/' + photo.ext
      return getExifDate(photo)
    })
    .then(async exifDate => {
      let hour = ' 00h00 - '
      if (exifDate) {
        // if newsdate - exifDate < 1j (= 1*24*60*60*1000 ms) then use exif hours
        if (photo.newsDate.diff(exifDate) < 86400000) {
          hour = exifDate.format(' HH[h]mm - ')
        }
      } else {
        exifDate = moment('1000-01-01 - 00:00', 'YYYY-MM-DD - HH:mm')
      }
      const filename = photo.newsDate.format('YYYY-MM-DD') + hour + photo.filename

      // require('fs').writeFileSync('data/' + filename, photo.body)

      // Get dir ID
      const dirDoc  = await cozyClient.files.statByPath(CTXT.fields.folderPath) // TODO : est on sûr que dirDoc existe ?

      // Test filename existance
      // should not happen since we tested if the file is already in the Cozy
      const isFileAlreadyInDir = await cozyClient.files.statByPath(CTXT.fields.folderPath + filename).catch(err=>{
        return false
      })
      if (isFileAlreadyInDir) throw new Error('File already in Cozy')

      // Save photo
      console.log('save photo');
      return cozyClient.files.create(bufferToStream(photo.body), {
        name            : filename                ,
        dirID           : dirDoc._id              ,
        contentType     : photo.mimeType          ,
        lastModifiedDate: photo.newsDate.format() ,
      })
    })
    .then(fileDoc => {
      CTXT.history.push({
        cozyId        : fileDoc._id    ,
        kidizzId      : photo.kidizzId ,
        retrievalDate : new Date()     ,
      })
    })
    .catch(err => {
      if (err.message === 'File already in Cozy') {
        log('info', 'File alread in Cozy')
      }else {
        log('error', err)
      }
    })
}

/**************************************************
GET EXIF Date from a photo (buffer)
returns momentjs object or undefined
***************************************************/
function getExifDate(photo) {
  let ext = photo.ext
  if (!(ext === 'jpg' || ext === 'jpeg' || ext === 'tiff'))
    return Promise.resolve(undefined) // TODO return undefined or Promise.resolve(undefined)  ?
  return readExif(photo.body).then(exifData => {
    if (exifData) {
      if (
        !exifData.exif.DateTimeOriginal ||
        exifData.exif.DateTimeOriginal === '0000:00:00 00:00:00'
      ) {
        return undefined
      }
      return moment(exifData.exif.DateTimeOriginal, 'YYYY:MM:DD HH:mm:ss')
    }
    return undefined
  })
}

function readExif(photo) {
  return new Promise(resolve => {
    new ExifImage({ image: photo }, function(error, exifData) {
      if (error) {
        log('error', error)
        resolve(undefined)
      } else {
        resolve(exifData)
      }
    })
  })
}

/********************************************
 * returns readableInstanceStream Readable
 *********************************************/
function bufferToStream(buffer) {
  const readableInstanceStream = new Readable({
    read() {
      this.push(buffer)
      this.push(null)
    }
  })
  return readableInstanceStream
}
