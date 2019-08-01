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

const CTXT = {} // persists the CONTEXT throug the run
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


/*******************************************************
When you run this connector yourself in "standalone" mode or "dev" mode,
the account information come from ./konnector-dev-config.json file
********************************************************/
async function start(fields) {
  CTXT.fields   = fields
  CTXT.NODE_ENV = process.env.NODE_ENV

  let accData, accDataFile
  if (CTXT.NODE_ENV == 'development') {
    let dirDoc, accDataFileText
    log('debug', `=============`)
    log('debug', `dev mode, get accData is simulated in the file ${CTXT.fields.folderPath}/accDataFile.json`)
    accDataFile = await cozyClient.files
      .statByPath(`${CTXT.fields.folderPath}/accDataFile.json`)
      .catch(() => undefined)
    if (accDataFile) {
      accDataFileText = await cozyClient.files.downloadById(accDataFile._id)
      accDataFileText = await accDataFileText.text()
    }
    if (!accDataFile || accDataFile.attributes.trashed ) {
      // file doesn't exists, create one
      dirDoc = await cozyClient.files.statByPath(CTXT.fields.folderPath)
        .catch(() => undefined)
      accDataFile = await cozyClient.files.create(
        ' ',
        {
          dirID            : dirDoc._id,
          name             : 'accDataFile.json',
          contentType      : 'text/plain',
          lastModifiedDate : new Date(),
        }
      )
      accData = {}
    } else {
      // file exists, download the data :
      if (accDataFileText.length < 2) {
        accData = {}
      } else {
        accData = JSON.parse(await accDataFileText)
      }
    }
    log('debug', `=============`)
  } else {
    // doesn't work in dev mode
    accData = this.getAccountData()
  }
  CTXT.history = Object.assign({photos:[], albumsId:{}, directoriesId:{}, mates:{}}, accData)

  log('info', 'Authenticating ...')
  await authenticateAndInitChildData(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of news')
  await retrieveNews()
  log('info', 'News successfully retrieved')

  log('info', 'Retrieving photos')
  await retrievePhotos()
  log('info', 'Photos successfully retrieved')

  log('info', `Retrieving the children's mates avatars`)
  await retrieveChildrenMates()
  log('info', `Children's Mates successfully retrieved`)

  log('info', 'Save Account DATA')

  if (CTXT.NODE_ENV != 'development') {
    await this.saveAccountData(CTXT.history, { merge: false })
    log('info', 'Account DATA saved')
  } else {
    await cozyClient.files.updateById(
      accDataFile._id,
      JSON.stringify(CTXT.history, null, '\t'),
      {
        contentType      : 'text/plain',
        lastModifiedDate : new Date()  ,
      }
    )
  }
}


/*******************************************************
AUTHENTICATION
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
      log('debug', 'auth OK')
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
  if (currentAlbumId) {
    // there was an album in history, try to retrieve the album doc from Cozy
    const albumDoc = await cozyClient.data.find(
        'io.cozy.photos.albums',
        currentAlbumId
      ).catch( () => undefined)
    if (albumDoc) {
      child.currentAlbumDoc = albumDoc
      currentAlbumId = albumDoc._id
    } else {
      currentAlbumId = undefined
    }
  }
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
  if (!dirDoc || !notInTrash(dirDoc)) {
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
      .statById(currentDirId, false, { limit: 100000 })
      .catch( () => undefined)
  }
  if (!dirDoc || !notInTrash(dirDoc)) {
    // there is no existing directory for mates in history (or dir in history no longer exists)
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
      log('debug', 'no dir to fetch, create one ')
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
  if (currentMatesAlbumId) {
    // there was an album in history, try to retrieve the album doc from Cozy
    matesAlbumDoc = await cozyClient.data.find(
        'io.cozy.photos.albums',
        currentMatesAlbumId
      )
    if (!matesAlbumDoc) currentMatesAlbumId = undefined
  }
  if (!currentMatesAlbumId) {
    // There is no album in history or the history album no longer exists
    // Create the album if needed or fetch the album with the default name
    [matesAlbumDoc] = await updateOrCreate(
        [{ name: defaultMatesAlbumName, created_at: new Date() }],
        'io.cozy.photos.albums',
        ['name']
      )
    CTXT.history.albumsId[`${child.id}-${child.section_name}-mateAlbumId`] = matesAlbumDoc._id
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
      // return true    // only to shorten tests
      return retrieveNews_rec(page + 1, child)
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
      let isInCozy = await isPhotoAlreadyInCozy(img.id)
      // check the image has not already been downloded
      if (isInCozy.docExists) continue
      let url = img.url
      url = path.dirname(url) + '/' + path.basename(url).replace(/^nc1000_/, '')
      let photo = {
        url             : url                          ,
        fileIdToUpdate  : null                         ,
        isAlbumToUpdate : true                         ,
        newsDate        : moment(news.post.created_at) ,
        child           : child                        ,
        kidizzId        : img.id                       ,
        histItem        : isInCozy.histItem            , // history item if the photo is already in history, null otherwise
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
        }
        log('info', `${newPhotoIds.length} files added to ${child.currentAlbumDoc.name}`)

      })
  )
}


/*******************************************************
 Returns :
  {
    docExists  : bolean       ,
    histItem   : history item ,
  }
********************************************************/
async function isPhotoAlreadyInCozy(kidizzPhotoId) {
  const existingHistItem = CTXT.history.photos.find(
    img => img.kidizzId === kidizzPhotoId
  )
  if (!existingHistItem) {
    log('debug', "photo doesn't exists in history " + kidizzPhotoId)
    return {docExists:false, histItem: null}
  }
  const existingHistItemDoc = await cozyClient.files.statById(existingHistItem.cozyId)
    .catch(() => undefined)
  if (!existingHistItemDoc || existingHistItemDoc.attributes.trashed) {
    log('debug', 'photo exists in history but NOT in Cozy - ' + existingHistItem.cozyId)
    return {docExists:false, histItem: existingHistItem}
  }
  log('debug', 'photo exists in history AND in Cozy : ' + existingHistItem.cozyId)
  return {docExists:true, histItem: existingHistItem}
}


function downloadPhoto(photo) {
  log('debug', 'start download photo ' + photo.kidizzId)
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
      photo.mimeType  = mime.getType(photo.ext)
      return getExifDate(photo)
    })
    .then(async exifDate => {
      let hour = ' 00h00 - '
      if (exifDate && photo.newsDate.diff(exifDate) < 86400000) {
        // if newsdate - exifDate < 1j (= 1*24*60*60*1000 ms) then use exif hours
        hour = exifDate.format(' HH[h]mm - ')
      }
      // Test filename existance to find the right filename
      // should not happen since we tested if the file is already in the history
      // but can happen if the history has been reset
      let   filename           = photo.newsDate.format('YYYY-MM-DD') + hour + photo.filename
      const dirContents        = photo.child.currentDirDoc.relations('contents')
      const isFileAlreadyInDir = dirContents.find(file => filename === file.attributes.name)
      if (isFileAlreadyInDir) photo.fileIdToUpdate = isFileAlreadyInDir._id

      // Save photo
      if (photo.fileIdToUpdate) {
        log('debug', 'update photo ' + filename)
        return cozyClient.files.updateById(
          photo.fileIdToUpdate,
          bufferToStream(photo.body),
          {
            contentType      : photo.mimeType,
            lastModifiedDate : photo.newsDate.format(),
          }
        )
      } else {
        log('debug', 'create photo ' + filename)
        return cozyClient.files.create(bufferToStream(photo.body), {
          name             : filename,
          dirID            : photo.child.currentDirDoc._id,
          contentType      : photo.mimeType,
          lastModifiedDate : photo.newsDate.format(),
        })
      }

    })
    .then(fileDoc => {
      const newHistoryItem = {
        cozyId        : fileDoc._id,
        kidizzId      : photo.kidizzId,
        retrievalDate : new Date().toISOString(),
      }
      // update history
      if (photo.histItem) {
        Object.assign(photo.histItem, newHistoryItem) // update the existing histroy item
      } else {
        CTXT.history.photos.push(newHistoryItem)      // create a new history item
      }
      // return history item only if it must be inserted in the album
      if (photo.isAlbumToUpdate) {
        return newHistoryItem
      } else {
        return undefined
      }
    })
    .catch(err => {
        log('error', 'Error during saving photo')
        log('error', err.message)
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
  const mates = CTXT.school.children.filter(mate => { mate.section_id === child.section_id })
  // B] prepare the avatarList : [ {url, mate, child, matesAvatarDirId, fileIdToUpdate},...]
  let avatarList = []
  const matesAvatarDirId = CTXT.history.directoriesId[`${child.id}-${child.section_name}-matesDir`]
  for (let mate of mates) {
    let avatar = mate.avatar.avatar
    avatar.url =  avatar.url.replace(/\?.*/, '')
    if (avatar.url[0] === '/') {
      avatar.url = 'https://api.kidizz.com' + avatar.url
    }
    let isInCozy = await isMatePhotoAlreadyInCozy(child, mate)
    if (isInCozy.docExists &&  isInCozy.isSameVersion) continue // check the mates image has not already been downloded
    if (isInCozy.docExists && !isInCozy.isSameVersion) {
      avatar = {
        url              : avatar.url,
        mate             : mate,
        storedMate       : isInCozy.storedMate, // the mate in history, null if it doesn't exist
        fileIdToUpdate   : isInCozy.storedMate.cozyAvatarId, // optionnal, might be undefined
        isAlbumToUpdate  : false,
        child            : child,
        matesAvatarDirId : matesAvatarDirId,
      }
    } else {
      avatar = {
        url              : avatar.url,
        mate             : mate,
        storedMate       : isInCozy.storedMate, // the mate in history, null if it doesn't exist
        fileIdToUpdate   : null, // optionnal, might be undefined
        isAlbumToUpdate  : true,
        child            : child,
        matesAvatarDirId : matesAvatarDirId,
      }
    }
    avatarList.push(avatar)
  }
  // B] download all avatars
  return (
    Promise.map(
      avatarList,
      avatar => downloadMateAvatar(avatar), { concurrency: 20 }
    )
  // C] Update avatars album
      .then(async mapresult => {
        let newAvatarIds
        newAvatarIds = mapresult.filter(item => item) // filter undefined items
        newAvatarIds = newAvatarIds.map(item => item.cozyAvatarId)
        if (newAvatarIds.length > 0) {
          log('debug', 'about to add mates avatar to mates album id ' + child.currentMatesAlbumDoc._id)
          await cozyClient.data.addReferencedFiles(
            child.currentMatesAlbumDoc,
            newAvatarIds
          )
        }
        log('info', `${newAvatarIds.length} avatar files added to ${child.currentMatesAlbumDoc.name}`)
      })
  )
}


/*******************************************************
returns :
  {
    docExists     : bolean       ,
    isSameVersion : bolean       ,
    storedMate    : history item ,
  }
********************************************************/
async function isMatePhotoAlreadyInCozy(child, mate) {
  // 1] check the mate's avatar is in history
  const storedMate = CTXT.history.mates[`${child.id}-${child.section_name}-${mate.id}`]
  if (!storedMate) {
    log('debug', `Mate's photo doesn't exists in history : ${mate.firstname} ${mate.lastname} - ${mate.id}` )
    return {docExists : false, isSameVersion: false, storedMate: null}
  }
  // 2] check if the previously downloaded avatar still exists
  const existingAvatarDoc = await cozyClient.files.statById(storedMate.cozyAvatarId)
    .catch(() => undefined)
  if (!existingAvatarDoc || existingAvatarDoc.attributes.trashed) {
    log('debug', `Mate's avatar exists in history BUT NOT in Cozy : ${mate.firstname} ${mate.lastname} - ${mate.id}`)
    return {docExists : false, isSameVersion: false, storedMate: storedMate}
  } else {
    // mate.existingAvatarId = existingAvatarDoc._id
  }
  // 3] check this is the last version of the avatar that is in history (avatar might have been updated)
  if (storedMate.kidizzAvatarId !== mate.avatar.avatar.url ) {
    log('debug', `Mate\'s photo has been updated on Kidizz : ${mate.firstname} ${mate.lastname} - ${mate.id}`)
    log('debug', storedMate.kidizzAvatarId )
    log('debug', mate.avatar.avatar.url )
    return {docExists : true, isSameVersion: false, storedMate: storedMate}
    // return [false, storedMate]
  }
  // 4] else the local avatar is uptodate
  log('debug', 'Mate\'s photo exists in history AND in Cozy AND versions are the same')
  return {docExists : true, isSameVersion: true, storedMate: storedMate}
  // return [true, storedMate]
}


function downloadMateAvatar(avatar) {
  const child = avatar.child
  const mate  = avatar.mate
  avatar.ext       = path.extname(URL.parse(avatar.url).pathname).slice(1).toLowerCase()
  avatar.mimeType  = mime.getType(avatar.ext)
  log('debug', `download avatar's mate : ${mate.firstname} ${mate.lastname}.${avatar.ext}`)
  return requestFactory({ json: true, cheerio: false, jar: true })
    .get({
      uri                     : avatar.url,
      encoding                : null,
      headers                 : { 'cache-control': 'no-cache' },
      resolveWithFullResponse : true,
    })
    .then(resp => {
      // Test filename existance
      const filename = `${mate.firstname} ${mate.lastname}.${avatar.ext}`
      // let   fileIdToUpdate  = avatar.fileIdToUpdate
      const isAvatarAlreadyInDir = child.currentMatesDirDoc
        .relations('contents')
        .find(file => filename == file.attributes.name)
      if (isAvatarAlreadyInDir) {
        log('debug', 'avatar with same filename already in mates dir, it will be updated ' + filename)
        mate.existingAvatarId  = isAvatarAlreadyInDir._id
        avatar.fileIdToUpdate  = isAvatarAlreadyInDir._id
        // avatar.isAlbumToUpdate = true
      }
      // Save avatar
      if (avatar.fileIdToUpdate) {
        log('debug', 'update avatar ' + filename)
        return cozyClient.files.updateById(
          avatar.fileIdToUpdate,
          bufferToStream(resp.body),
          {
            contentType      : avatar.mimeType,
            lastModifiedDate : new Date().toISOString(),
            // metadata         : { datetime: new Date().toISOString() },
          }
        )
      } else {
        log('debug', 'create avatar ' + filename)
        return cozyClient.files.create(bufferToStream(resp.body), {
          name             : filename,
          dirID            : avatar.matesAvatarDirId,
          contentType      : avatar.mimeType,
          lastModifiedDate : new Date().toISOString(),
          // metadata         : { datetime: new Date().toISOString() },
        })
      }
    })
    .then(fileDoc => {
      const historyMate = {
        cozyAvatarId   : fileDoc._id,
        kidizzAvatarId : avatar.url,
        retrievalDate  : new Date().toISOString(),
      }
      CTXT.history.mates[`${child.id}-${child.section_name}-${mate.id}`] = historyMate
      if (avatar.isAlbumToUpdate){
        return historyMate
      }
      return undefined
    })
    .catch(err => {
      if (err.message === 'Avatar with same path already in Cozy') {
        log('info', err.message)
      } else {
        log('error', err)
      }
    })
}



/****************************************************************************************
 * HELPERS
 *****************************************************************************************/


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


/********************************************
 * test if a file or directory is trashed
 * returns a boolean
 *********************************************/
function notInTrash (file) {
  // console.log( !file.trashed );
  // console.log(  !/^\/\.cozy_trash/.test(file.path) );
  return !file.trashed && !/^\/\.cozy_trash/.test(file.path)
}
