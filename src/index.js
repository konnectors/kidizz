/* eslint-disable */

/* Sentry configuration */
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://1d87850b15df4bd0a97b9494d71bde92@sentry.cozycloud.cc/128'

/* SET DEBUG ENVIRONEMNT VARIABLE TO FALSE TO AVOID LOGS FROM THE EXIF LIB */
process.env['DEBUG'] = true

/* GLOBALS */
const Promise   = require('bluebird')
const path      = require('path')
const Readable  = require('stream').Readable
const moment    = require('moment')
const ExifImage = require('exif').ExifImage
const mime      = require('mime')
const URL       = require('url')

var {
  BaseKonnector  ,
  requestFactory ,
  log            ,
  updateOrCreate ,
  cozyClient     ,
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
  ],
  school:{             // data of the school
    children:[],       // all children of the school
    sections:[],
    users:[],
  }
}
CTXT.history = {

  photos: [{
    cozyId        : fileDoc._id    , // INT
    kidizzId      : photo.kidizzId , // INT
    retrievalDate : new Date()     , // ISO8601 formated STRING
  }],

  albumsId:      {   // stores both photo albums ids and mate albums ids
    '{childId}-{section_name}-photoAlbum': photoAlbumId,
    '{childId}-{section_name}-matesAlbum': mateAlbumId
  },

  directoriesId:      {   // stores both photo directories ids and mate avatars directories ids
    '{childId}-{section_name}-photoDir': photoDirId,
    '{childId}-{section_name}-matesDir': mateDirId
  },

  mates:{'{childId}-{section_name}-{mateId}': {
      cozyAvatarId : ,
      kidizzAvatarId: ,   // the url of the file
      retrievalDate: ,
    }
  },

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
  // accData = Object.assign({photos:[], albumsId:{}, directoriesId:{}}, accData)
  let histData = {
    photos       : accData.photos        ? accData.photos        : [] ,
    albumsId     : accData.albumsId      ? accData.albumsId      : {} ,
    directoriesId: accData.directoriesId ? accData.directoriesId : {} ,
    mates        : accData.mates         ? accData.mates         : {} ,
  }
  log('debug', 'histData :' + histData )
  log('debug', JSON.stringify(histData))
  log('debug', 'secret.histData :')
  log('secret', histData) // TODO utile ?
  // if (!histData.photos) histData.photos = []
  // if (!histData.albumsId) histData.albumsId = {}
  // if (!histData.directoriesId) histData.directoriesId = {}
  CTXT.history = histData

  log('info', 'Authenticating ...')
  await authenticateAndInitChildData(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of news')
  await retrieveNews()
  log('info', 'News successfully retrieved')

  log('info', 'Fetching the photos')
  await retrievePhotos()
  log('info', 'Photos successfully retrieved')

  log('info', 'Fetching the children\'s mates')
  await retrieveChildrenMates()
  log('info', 'ChildrensMates successfully retrieved')

  log('info', 'Save Account DATA...')
  log('debug', 'account data to save is :')
  log('debug', JSON.stringify(CTXT.history))
  if (CTXT.NODE_ENV != 'development') {
    await this.saveAccountData(CTXT.history, { merge: false })
    log('info', 'Account DATA saved')
  }
}


/*******************************************************
AUTHENTICATION
TODO : store the response cookie to be reused on next run
********************************************************/
function authenticateAndInitChildData(login, password) {
  return requestFactory({json: true, cheerio: false, jar: true})
    .post({
      uri    : 'https://api.kidizz.com/accounts/sign_in',
      body   : { account: { email: login, password: password, remember_me: 1 } },
      headers: {
        Connection       : 'Keep-Alive',
        Host             : 'api.kidizz.com',
        Accept           : 'application/vnd.kidizz.api+json, application/json;q=0.9',
        'cache-control'  : 'no-cache',
        'Accept-Encoding': 'gzip',
        'Content-Type'   : 'application/json; charset=UTF-8',
        'X-API-Version'  : '1.0.1',
        'User-Agent'     : 'Kidizz Android (com.kidizz.KidizzApp)/2.5.7'
      }
    })
    .then(async res => {
      // retrieve children and init data (news, currentAlbumDoc, currentDirDoc, currentAvatarDirDoc)
      CTXT.children = res.user.children
      for (let child of CTXT.children) {
        await retrieveChildData(child)
      }
    })
    .catch(err => {
      log('error', err.message)
      throw new Error(errors.LOGIN_FAILED)
    })
}


async function retrieveChildData(child) {
  // __0/ child.firstname and Lastname
  child.firstname = child.firstname.slice(0,1).toUpperCase() + child.firstname.slice(1).toLowerCase()
  child.lastname  = child.lastname.toUpperCase()
  // __1/ child.news init
  child.news = []
  // __2/ child.currentAlbumDoc init
  let currentAlbumId = CTXT.history.albumsId[`${child.id}-${child.section_name}-photoAlbum`]
  if (!currentAlbumId) {
    // there is no album in history,
    // create the album if needed or fetch the album with the default name
    const defaultAlbumName = `${child.firstname} - crèche ${child.section_name}`
    const [albumDoc] = await updateOrCreate(
      [{ name: defaultAlbumName, created_at: new Date() }],
      'io.cozy.photos.albums',
      ['name']
    )
    child.currentAlbumDoc = albumDoc
    CTXT.history.albumsId[`${child.id}-${child.section_name}-photoAlbum`] = albumDoc._id
  } else {
    // there was an album in history, retrieve the album doc from Cozy
    const albumDoc = await cozyClient.data.find(
      'io.cozy.photos.albums',
      currentAlbumId
    )
    child.currentAlbumDoc = albumDoc
  }
  // __3/ child.currentDirDoc init
  log('debug', 'get photo dir id')
  let dirDoc
  let currentDirId = CTXT.history.directoriesId[`${child.id}-${child.section_name}-photoDir`]
  if (currentDirId) {
    // there is a directory in history, just test it still exists
    dirDoc = await cozyClient.files
      .statById(currentDirId, false, { limit: 10000 })
      .catch( () => undefined)
  }
  if (!dirDoc) {
    // there is no existing directory in history
    // try to fetch the directory with the default path or create a new one
    const defaultAlbumPath = `${CTXT.fields.folderPath}/${child.firstname} - crèche ${child.section_name}`
    log('debug', 'no dir in history, try to fetch : ' + defaultAlbumPath)
    dirDoc = await cozyClient.files
      .statByPath(defaultAlbumPath)
      .catch(() => undefined)
    if (dirDoc) {
      dirDoc = await cozyClient.files.statById(dirDoc._id, false, {limit: 10000}) // because statByPath doesn't implement option:limit...
    }
    if (!dirDoc) {
      log('debug', 'no dir to fetch, create one with path :' + defaultAlbumPath)
      dirDoc = await cozyClient.files.createDirectoryByPath(defaultAlbumPath)
      dirDoc = await cozyClient.files.statById(dirDoc._id) // otherwise dirDoc.relations('contents') fails...
    }
    CTXT.history.directoriesId[`${child.id}-${child.section_name}-photoDir`] = dirDoc._id
  }
  log('debug', 'in the end, photo dirDoc id =' + dirDoc._id )
  child.currentDirDoc = dirDoc
  // __4/ child.currentMatesDirDoc init
  log('debug', 'get avatars dir id')
  dirDoc = undefined
  currentDirId = CTXT.history.directoriesId[`${child.id}-${child.section_name}-matesDir`]
  const defaultMatesAlbumName = `${child.firstname} - copains crèche ${child.section_name}`
  if (currentDirId) {
    // there is a directory in history, just test it still exists
    dirDoc = await cozyClient.files
      .statById(currentDirId, false, { limit: 10000 })
      .catch( () => undefined)
  }
  if (!dirDoc) {
    // there is no existing directory for mates in history
    // try to fetch the directory with the default path or create a new one
    const defaultMatesDirPath  = `${CTXT.fields.folderPath}/${defaultMatesAlbumName}`
    log('debug', 'no dir in history, try to fetch ' + defaultMatesDirPath)
    dirDoc = await cozyClient.files
      .statByPath(defaultMatesDirPath)
      .catch(() => undefined)
    if (dirDoc) {
      dirDoc = await cozyClient.files.statById(dirDoc._id, false, {limit: 10000}) // because statByPath doesn't implement option:limit...
    }
    log('debug', defaultMatesDirPath)
    if (!dirDoc) {
      log('debug', 'no dit to fetch, create one ')
      dirDoc = await cozyClient.files.createDirectoryByPath(defaultMatesDirPath)
      dirDoc = await cozyClient.files.statById(dirDoc._id) // otherwise dirDoc.relations('contents') fails...
    }
    CTXT.history.directoriesId[`${child.id}-${child.section_name}-matesDir`] = dirDoc._id
  }
  log('debug', 'in the end, mates DirDoc id = ' + dirDoc._id)
  child.currentMatesDirDoc = dirDoc
  // __5/ child.currentMatesAlbumDoc init
  log('debug', 'Find the mates avatar album')
  let matesAlbumDoc
  let currentMatesAlbumId = CTXT.history.albumsId[`${child.id}-${child.section_name}-mateAlbumId`]
  if (!currentMatesAlbumId) {
    // there is no album in history,
    // create the album if needed or fetch the album with the default name
    [matesAlbumDoc] = await updateOrCreate(
      [{ name: defaultMatesAlbumName, created_at: new Date() }],
      'io.cozy.photos.albums',
      ['name']
    )
    CTXT.history.albumsId[`${child.id}-${child.section_name}-mateAlbumId`] = matesAlbumDoc._id
  } else {
    // there was an album in history, retrieve the album doc from Cozy
    matesAlbumDoc = await cozyClient.data.find(
      'io.cozy.photos.albums',
      currentMatesAlbumId
    )
  }
  log('debug', 'in the end, mates avatar album Doc id = ' + matesAlbumDoc._id)
  child.currentMatesAlbumDoc = matesAlbumDoc
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
      qs     : { current_child: child.id, page: page },
      uri    : 'https://api.kidizz.com/activities',
      headers: {
        Connection        : 'Keep-Alive',
        Host              : 'api.kidizz.com',
        Accept            : 'application/vnd.kidizz.api+json, application/json;q=0.9',
        'cache-control'   : 'no-cache',
        'Accept-Encoding' : 'gzip',
        'Content-Type'    : 'application/json; charset=UTF-8',
        'X-API-Version'   : '1.0.1',
        'User-Agent'      : 'Kidizz Android (com.kidizz.KidizzApp)/2.5.7'
      }
    })
    .then(news => {
      if (news.length === 0) return true
      //concat all the news pages into CTXT.children[i].news
      child.news = child.news.concat(news)
      return true // TODO : remove, only to shorten tests
      // return retrieveNews_rec(page + 1, child)
    })
    .catch(err => log('error', err) )
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
        url      : url,
        newsDate : moment(news.post.created_at),
        child    : child,
        kidizzId : img.id
      }
      photosList.push(photo)
    }
  }
  // B] download all photos
  return (
    Promise.map(
      photosList,
      photo => downloadPhoto(photo),
      { concurrency: 20 }
    )
  // C] Update photo album
      .then(async mapresult => {
        let newPhotoIds
        newPhotoIds = mapresult.filter(item => item) // filters undefined items (photo with a file with same name)
        newPhotoIds = newPhotoIds.map(item => item.cozyId)
        if (newPhotoIds.length > 0) {
          await cozyClient.data.addReferencedFiles(
            child.currentAlbumDoc,
            newPhotoIds
          )
          log('info', `${newPhotoIds.length} files added to ${child.currentAlbumDoc.name}`)
        }
      })
  )
}


async function isPhotoAlreadyInCozy(kidizzPhotoId) {
  // TODO full history cycle to be tested
  const existingImg = CTXT.history.photos.find(
    img => img.kidizzId === kidizzPhotoId
  )
  if (!existingImg) {
    log('debug', "photo doesn't exists in history " + kidizzPhotoId)
    return false
  }
  log('debug', 'photo exists in history ' + kidizzPhotoId)
  const existingImgDoc = await cozyClient.files.statById(existingImg.cozyId) // TODO to be tested in dev mode (when getAccoundData will work)
  if (!existingImgDoc) {
    log(
      'debug',
      'photo exists in history but NOT in Cozy - ' + existingImg.cozyId
    ) // TODO : to be tested
    return false
  }
  log('debug', 'photo exists in history AND in Cozy' + existingImg.cozyId)
  return true
}


function downloadPhoto(photo) {
  return requestFactory({ json: true, cheerio: false, jar: true })
    .get({
      uri                     : photo.url,
      encoding                : null,
      headers                 : { 'cache-control': 'no-cache' },
      resolveWithFullResponse : true
    })
    .then(resp => {
      photo.body      = resp.body
      photo.filename  = path.basename(photo.url).replace(/\?.*/, '')
      photo.ext       = photo.filename.toLowerCase().match(/[\w]*$/)[0]
      // photo.mimeType  = 'image/' + photo.ext
      photo.mimeType  = mime.getType(photo.ext)
      return getExifDate(photo)
    })
    .then(async exifDate => {
      let hour = ' 00h00 - '
      if (exifDate && photo.newsDate.diff(exifDate) < 86400000) {
        // if newsdate - exifDate < 1j (= 1*24*60*60*1000 ms) then use exif hours
        hour = exifDate.format(' HH[h]mm - ')
      }
      const filename = photo.newsDate.format('YYYY-MM-DD') + hour + photo.filename
      // Test filename existance
      // should not happen since we tested if the file is already in the Cozy
      const isFileAlreadyInDir = photo.child.currentDirDoc
        .relations('contents')
        .find(file => filename == file.attributes.name)
      if (isFileAlreadyInDir)
        throw new Error('File with same path already in Cozy')
      // Save photo
      log('debug', 'save photo ' + filename )
      return cozyClient.files.create(bufferToStream(photo.body), {
        name             : filename,
        dirID            : photo.child.currentDirDoc._id,
        // contentType      : 'image/jpeg', // photo.mimeType, TODO
        contentType      : photo.mimeType, // TODO
        // lastModifiedDate : photo.newsDate.format(),
        lastModifiedDate : new Date().toISOString(),
        metadata: {
          datetime: photo.newsDate.format()
        }
        // metadata         : { datetime: photo.newsDate.format() }
        // metadata         : { datetime: new Date().toISOString() }
      })
    })
    .then(fileDoc => {
      const historyItem = {
        cozyId        : fileDoc._id,
        kidizzId      : photo.kidizzId,
        retrievalDate : new Date().toISOString()
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


/*******************************************************
RETRIEVE CHILDREN MATES for each child
********************************************************/
async function retrieveChildrenMates() {
  await retrieveAllChildrenFromSchool()
  const promises = []
  for (let child of CTXT.children) {
    promises.push(__retrieveMates(child))
  }
  return Promise.all(promises)
}

async function retrieveAllChildrenFromSchool(){
  let areChildrenFound = false
  // loop over all children's news to find one having the school details (users, children and sections)
  for (let child of CTXT.children) {
    for (let news of child.news) {
      newsDetail = await requestFactory({ json: true, cheerio: false, jar: true })
        .get({
          uri    : 'https://api.kidizz.com/news/' + news.id,
          headers: {
            Connection        : 'Keep-Alive',
            Host              : 'api.kidizz.com',
            // Accept            : 'application/vnd.kidizz.api+json, application/json;q=0.9',
            Accept            : '*/*',  // this is the trick to get the full detail of all the children
            'cache-control'   : 'no-cache',
            'Accept-Encoding' : 'deflate',
            'X-API-Version'   : '1.0.1',
            'User-Agent'      : 'Kidizz Android (com.kidizz.KidizzApp)/2.5.7'
          }
        })
      areChildrenFound = newsDetail.children && newsDetail.children.length > 0
      if (areChildrenFound) {
        CTXT.school = {
          children : newsDetail.children,
          sections : newsDetail.sections,
          users    : newsDetail.users   ,
        }
        break
      }
    }
    if (areChildrenFound) break
  }
}

async function __retrieveMates(child) {
  // A] get all the children of the same section
  const mates    = CTXT.school.children.filter(mate => mate.section_id == child.section_id)
  // B] prepare the avatarList : [ {url, mate, child, matesAvatarDirId, fileIdToUpdate},...]
  let avatarList = []
  const matesAvatarDirId = CTXT.history.directoriesId[`${child.id}-${child.section_name}-matesDir`]
  for (let mate of mates) {
    if (await isMatePhotoAlreadyInCozy(child, mate)) continue // check the mates image has not already been downloded
    let photo = {
      url              : mate.avatar.avatar.url,
      mate             : mate,
      child            : child,
      matesAvatarDirId : matesAvatarDirId,
      fileIdToUpdate   : mate.existingAvatardId, // optionnal, might be undefined
    }
    avatarList.push(photo)
  }
  // B] download all avatars
  return (
    Promise.map(
      avatarList,
      photo => downloadMatePhoto(photo), { concurrency: 20 }
    )
  // C] Update avatars album
      .then(async mapresult => {
        let newAvatarIds
        newAvatarIds = mapresult.filter(item => item) // filters undefined items (photo with a file with same name)
        newAvatarIds = newAvatarIds.map(item => item.cozyAvatarId)
        if (newAvatarIds.length > 0) {
          log('debug', 'about to add mates avatar to mates album id ' + child.currentMatesAlbumDoc._id)
          await cozyClient.data.addReferencedFiles(
            child.currentMatesAlbumDoc,
            newAvatarIds
          )
          log('info', `${newAvatarIds.length} avatar files added to ${child.currentMatesAlbumDoc.name}`)
        }
      })
  )
}


async function isMatePhotoAlreadyInCozy(child, mate) {

  // check the mate's avatar is in history
  const storedMate = CTXT.history.mates[`${child.id}-${child.section_name}-${mate.id}`]
  if (!storedMate) {
    log('debug', `Mate's photo doesn't exists in history : ${mate.firstname} ${mate.lastname} - ${mate.id}` )
    return false
  }
  // check if the previously downloaded avatar still exists
  const existingAvatarDoc = await cozyClient.files.statById(storedMate.cozyAvatarId)
  if (!existingAvatarDoc) {
    log('debug', `Mate's photo exists in history BUT NOT in Cozy : ${mate.firstname} ${mate.lastname} - ${mate.id}`)
    return false
  } else {
    mate.existingAvatardId = existingAvatarDoc._id
  }
  // check the avatar has not been modifed on kidizz
  if (storedMate.kidizzAvatarId !== mate.avatar.avatar.url ) {
    log('debug', `Mate\'s photo has been updated on Kidizz : ${mate.firstname} ${mate.lastname} - ${mate.id}`)
    log('debug', storedMate.kidizzAvatarId )
    log('debug', mate.avatar.avatar.url )

    return false
  }
  // else the local avatar is uptodate
  log('debug', 'Mate\'s photo exists in history AND in Cozy AND has not been updated on Kidizz')
  return true
}



function downloadMatePhoto(photo) {
  const child = photo.child
  const mate  = photo.mate
  if (photo.url[0] === '/') {
    photo.url = 'https://api.kidizz.com' + photo.url
  }
  photo.ext       = path.extname(URL.parse(photo.url).pathname).slice(1).toLowerCase()
  photo.mimeType  = mime.getType(photo.ext)
  log('debug', `download photo mate : ${mate.firstname} ${mate.lastname}.${photo.ext}`)
  return requestFactory({ json: true, cheerio: false, jar: true })
    .get({
      uri                     : photo.url,
      encoding                : null,
      headers                 : { 'cache-control': 'no-cache' },
      resolveWithFullResponse : true,
    })
    .then(resp => {

      // Test filename existance
      const filename = `${mate.firstname} ${mate.lastname}.${photo.ext}`
      const isAvatarAlreadyInDir = child.currentMatesDirDoc
        .relations('contents')
        .find(file => filename == file.attributes.name)
      if (isAvatarAlreadyInDir) {
        log('debug', 'avatar with same filename already in mates dir, it will be updated ' + filename)
        mate.existingAvatardId = isAvatarAlreadyInDir._id
        photo.fileIdToUpdate   = isAvatarAlreadyInDir._id
      }
      // Save avatar
      if (photo.fileIdToUpdate) {
        log('debug', 'update avatar ' + filename)
        return cozyClient.files.updateById(
          photo.fileIdToUpdate,
          bufferToStream(resp.body),
          {
            contentType      : photo.mimeType,
            lastModifiedDate : new Date().toISOString(),
            // metadata         : { datetime: new Date().toISOString() },
          }
        )
      } else {
        log('debug', 'create avatar ' + filename)
        return cozyClient.files.create(bufferToStream(resp.body), {
          name             : filename,
          dirID            : photo.matesAvatarDirId,
          contentType      : photo.mimeType,
          lastModifiedDate : new Date().toISOString(),
          // metadata         : { datetime: new Date().toISOString() },
        })
      }
    })
    .then(fileDoc => {
      const historyMate = {
        cozyAvatarId   : fileDoc._id,
        kidizzAvatarId : photo.url,
        retrievalDate  : new Date().toISOString(),
      }
      CTXT.history.mates[`${child.id}-${child.section_name}-${mate.id}`] = historyMate
      if (photo.fileIdToUpdate){
        return undefined //  if the avatar file has been updated, then it is not to be added to the album
      }
      return historyMate
    })
    .catch(err => {
      if (err.message === 'Avatar with same path already in Cozy') {
        log('info', err.message)
      } else {
        log('error', err)
      }
    })
}
