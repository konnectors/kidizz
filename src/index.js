/* SET DEBUG ENVIRONEMNT VARIABLE TO FALSE TO AVOID LOGS FROM THE EXIF LIB */
process.env['DEBUG'] = true
const now = require('performance-now')

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
  updateOrCreate,
  cozyClient,
  errors
} = require('cozy-konnector-libs')

const CTXT = {} // persists the context throug the run
/*
CTXT = {
  fields   : fields ,         //
  NODE_ENV : string,          // undefined in prod, 'development' in dev mode, 'standalone' in standalone
  history  : {}     ,         // retrieved from account data, see below
  children : [                // the list of children retrieved from the API
    {
      id               ,
      news:[]          ,
      firstname        ,
      lastname         ,
      section_name     ,
      currentAlbumDoc  , // = the album    doc where to add the photos this this child
      currentDirId     , // = the directory id where to add the photos this this child
      birthday         ,
      avatar_url       ,
      ... rest from the api ,
    }
  ]
}
CTXT.history = {
  photos: [{
    cozyId        : fileDoc._id    , // INT
    kidizzId      : photo.kidizzId , // INT
    retrievalDate : new Date()     , // ISO8601 formated STRING
  }],
  albumsId:      {'childId-section_name': photoAlbumId},
  directoriesId: {'childId-section_name': photoDirectoryId},
}

 */

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  CTXT.fields = fields
  CTXT.NODE_ENV = process.env.NODE_ENV

  let accData
  if (CTXT.NODE_ENV == 'development') {
    accData = {}
  } else {
    accData = this.getAccountData() // doesn't work in dev mode
  }
  if (!accData.photos) accData.photos = []
  if (!accData.albumsId) accData.albumsId = {}
  if (!accData.directoriesId) accData.directoriesId = {}
  CTXT.history = accData

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
  log('debug', 'account data saved are :')
  log('debug', CTXT.history)

  if (CTXT.NODE_ENV != 'development') {
    await this.saveAccountData({ history: CTXT.history }, { merge: false })
  }
  log('info', 'Account DATA saved')
}

/*******************************************************
AUTHENTICATION
TODO : store the response cookie to be reused on next run
********************************************************/
function authenticate(login, password) {
  return requestFactory({
    json: true,
    cheerio: false,
    jar: true
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
    .then(async res => {
      // retrieve children and init data
      CTXT.children = res.user.children
      CTXT.children.forEach(async child => {
        // 1/ child.news init
        child.news = []
        // 2/ child.currentAlbumDoc init
        let currentAlbumId =
          CTXT.history.albumsId[`${child.id}-${child.section_name}`]
        if (!currentAlbumId) {
          // if there was no album in history
          // create the album if needed or fetch the album with the default name
          const defaultAlbumName = `${child.firstname} - crèche ${
            child.section_name
          }`
          const [albumDoc] = await updateOrCreate(
            [{ name: defaultAlbumName, created_at: new Date() }],
            'io.cozy.photos.albums',
            ['name']
          )
          child.currentAlbumDoc = albumDoc
          CTXT.history.albumsId[`${child.id}-${child.section_name}`] =
            albumDoc._id
        } else {
          // there was an album in history, retrieve the album doc from Cozy
          const albumDoc = await cozyClient.data.find(
            'io.cozy.photos.albums',
            currentAlbumId
          )
          child.currentAlbumDoc = albumDoc
        }
        // 3/ child.currentDirId init
        let currentDirId =
          CTXT.history.directoriesId[`${child.id}-${child.section_name}`]
        if (!currentDirId) {
          // there was a directory in history, easy
          child.currentDirId = currentDirId
        } else {
          // there was no directory in history
          // create the directoryor fetch the one with the default path
          const defaultAlbumPath = `${child.firstname} - crèche ${
            child.section_name
          }`
          // const [albumDoc] = await updateOrCreate(
          //   [{ name: defaultAlbumName, created_at: new Date() }],
          //   'io.cozy.photos.albums',
          //   ['name']
          // )
          // child.currentDirId = albumDoc._id
          // CTXT.history.directoriesId[`${child.id}-${child.section_name}`] = albumDoc._id
        }
      })
    })
    .catch(err => {
      log('error', err.message)
      throw new Error(errors.LOGIN_FAILED)
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
  return requestFactory({ json: true, cheerio: false, jar: true })
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
      // return true
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
    promises.push(__retrievePhotos(child))
  }
  return Promise.all(promises)
}

async function __retrievePhotos(child) {
  // A] prepare the photosList : [{url, newsDate, child, kidizzId},...]
  let photosList = []
  for (let news of child.news) {
    if (!(news.post && news.post.images)) continue // check the post has some photo
    for (let img of news.post.images) {
      if (await isPhotoAlreadyInCozy(img.id)) continue // check the image has not already been downloded
      let url = img.url
      url = path.dirname(url) + '/' + path.basename(url).replace(/^nc1000_/, '')
      let photo = {
        url: url,
        newsDate: moment(news.post.created_at),
        child: child,
        kidizzId: img.id
      }
      photosList.push(photo)
    }
  }
  // B] download all photos
  return (
    Promise.map(photosList, photo => downloadPhoto(photo), { concurrency: 10 })
      // C] Update photo album
      .then(async mapresult => {
        let newPhotoIds
        newPhotoIds = mapresult.filter(item => item) // filters undefined items (photo with a file with same name)
        newPhotoIds = newPhotoIds.map(item => item.cozyId)
        // // create the album if needed or fetch the correponding existing album
        // const albumName = `${child.firstname} - crèche ${child.section_name}`
        // const [albumDoc] = await updateOrCreate(
        //   [{ name: albumName, created_at: new Date() }],
        //   'io.cozy.photos.albums',
        //   ['name']
        // )
        await cozyClient.data.addReferencedFiles(
          child.currentAlbumDoc,
          newPhotoIds
        )
        log(
          'info',
          `${newPhotoIds.length} files added to ${child.currentAlbumDoc.name}`
        )
      })
  )
}

async function isPhotoAlreadyInCozy(kidizzPhotoId) {
  // TODO full history cycle to be tested
  const existingImg = CTXT.history.photos.find(
    img => img.kidizzId === kidizzPhotoId
  )
  if (!existingImg) {
    log('debug', "photo doesn't exists in history", kidizzPhotoId)
    return false
  }
  log('debug', 'photo exists in history ' + kidizzPhotoId)

  const existingImgDoc = await cozyClient.files.statById(existingImg.cozyId) // TODO to be tested in dev mode (when getAccoundData will work)
  // log('debug', 'existingImgDoc ' + existingImgDoc)

  if (!existingImgDoc) {
    log(
      'debug',
      'photo exists in history but NOT in Cozy - ' + existingImg.cozyId
    ) // TODO : to be tested
    return false
  }

  log('debug', 'test photo exists in history AND in Cozy')

  return true
}

function downloadPhoto(photo) {
  return requestFactory({ json: true, cheerio: false, jar: true })
    .get({
      uri: photo.url,
      encoding: null,
      headers: { 'cache-control': 'no-cache' },
      resolveWithFullResponse: true
    })
    .then(resp => {
      photo.body = resp.body
      photo.filename = path.basename(photo.url).replace(/\?.*/, '')
      photo.ext = photo.filename.toLowerCase().match(/[\w]*$/)[0]
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
      }
      const filename =
        photo.newsDate.format('YYYY-MM-DD') + hour + photo.filename

      // Get dir ID
      // TODO : le path en dev mode est cozy-konnector-dev-root ... comment le mettre dans Drive/Photos/Crèche ?
      const dirDoc = await cozyClient.files.statByPath(CTXT.fields.folderPath)

      // Test filename existance
      // should not happen since we tested if the file is already in the Cozy
      const isFileAlreadyInDir = await cozyClient.files
        .statByPath(CTXT.fields.folderPath + '/' + filename) // TODO to be tested in dev mode
        .catch(() => {
          return false
        })
      if (isFileAlreadyInDir)
        throw new Error('File with same path already in Cozy')

      // Save photo
      log('debug', 'save photo')
      return cozyClient.files.create(bufferToStream(photo.body), {
        name: filename,
        dirID: dirDoc._id,
        contentType: 'image/JPG', // photo.mimeType,
        lastModifiedDate: photo.newsDate.format()
      })
    })
    .then(fileDoc => {
      const historyItem = {
        cozyId: fileDoc._id,
        kidizzId: photo.kidizzId,
        retrievalDate: new Date().toISOString()
      }
      CTXT.history.photos.push(historyItem)
      return historyItem
    })
    .catch(err => {
      if (err.message === 'File with same path already in Cozy') {
        log('info', 'File with same path already in Cozy')
      } else {
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
  if (!(ext === 'jpg' || ext === 'jpeg' || ext === 'tiff')) return undefined
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
