/**
 * @file ALSong.js
 * @brief ALSong (알송) Sync Lyrics Searcher for ESLyric (foobar2000)
 * @version 1.0.0
 * @author yhsphd
 * @license MIT
 *
 * @description
 * ESLyric 플러그인을 위한 알송 실시간 싱크가사 검색 스크립트입니다.
 * 전용 정규식 XML 파서와 스마트 가사 매칭 랭킹 알고리즘을 내장하고 있습니다.
 */

// ============================================================================
// 1. 상수 정의 (Constants)
// ============================================================================

/** @type {string} 알송 가사 웹서비스 SOAP 엔드포인트 URL */
const ALSONG_ENDPOINT = "http://lyrics.alsong.co.kr/alsongwebservice/service1.asmx";

/**
 * @type {string} 알송 클라이언트 인증용 RSA-1024 서명 토큰
 * 알송 프로토콜 규격(RSA-1024 + PKCS#1 v1.5)에 따라 생성된 유효한 인증 암호문입니다.
 */
const ALSONG_ENC_DATA =
    "8456ec35caba5c981e705b0c5d76e4593e020ae5e3d469c75d1c6714b6b1244c0732f1f19cc32ee5123ef7de574fc8bc6d3b6bd38dd3c097f5a4a1aa1b438fea0e413baf8136d2d7d02bfcdcb2da4990df2f28675a3bd621f8234afa84fb4ee9caa8f853a5b06f884ea086fd3ed3b4c6e14f1efac5a4edbf6f6cb475445390b0";

/** @type {Object<string, string>} SOAP 1.2 표준 HTTP 요청 헤더 */
const SOAP_HEADERS = {
    "Accept-Charset": "utf-8",
    "Content-Type": "application/soap+xml; charset=utf-8",
    "User-Agent": "gSOAP/2.7",
    "SOAPAction": "ALSongWebServer/GetResembleLyric2"
};

/**
 * @type {Object<string, number>} 가사 매칭 점수 산정 가중치 (총 100점 만점)
 */
const SCORE_WEIGHTS = {
    TITLE_EXACT: 45,        // 제목 완전 일치
    TITLE_CONTAIN: 30,      // 제목 부분 포함
    TITLE_SIMILAR_MAX: 25,  // 제목 문자열 유사도 가중치
    ARTIST_EXACT: 30,       // 가수명 완전 일치
    ARTIST_CONTAIN: 20,     // 가수명 부분 포함
    ARTIST_SIMILAR_MAX: 15, // 가수명 문자열 유사도 가중치
    ALBUM_EXACT: 10,        // 앨범명 일치
    SYNC_EXISTS: 10,        // 타임태그([mm:ss.xx]) 포함 여부
    SYNC_SUFFICIENT: 5      // 싱크 라인이 10줄 이상으로 충분한 경우
};

// ============================================================================
// 2. ESLyric 플러그인 인터페이스 (Plugin Exports)
// ============================================================================

/**
 * ESLyric에 검색기 메타데이터를 등록합니다.
 * @param {Object} cfg - ESLyric 설정 객체
 * @param {string} cfg.name - 검색기 명칭
 * @param {string} cfg.version - 버전 정보
 * @param {string} cfg.author - 작성자
 */
export function getConfig(cfg) {
    cfg.name = "ALSong";
    cfg.version = "1.0.0";
    cfg.author = "yhsphd";
}

/**
 * 음원 재생 시 ESLyric에 의해 호출되는 메인 가사 검색 함수입니다.
 * @param {Object} meta - 현재 트랙의 메타데이터
 * @param {string} meta.title - 곡 제목
 * @param {string} meta.artist - 가수명
 * @param {string} meta.album - 앨범명
 * @param {number} meta.duration - 곡 재생 시간 (초 단위)
 * @param {Object} man - ESLyric 가사 관리자 인스턴스
 */
export function getLyrics(meta, man) {
    if (!meta || meta.duration === 0) {
        return;
    }

    const title = meta.title || "";
    const artist = meta.artist || "";

    if (!title && !artist) {
        return;
    }

    fetchAlsongLyrics(title, artist, (candidates) => {
        if (!candidates || candidates.length === 0) {
            return;
        }

        // 1. 후보군 매칭 점수 채점 및 내림차순 정렬
        for (const candidate of candidates) {
            candidate.score = calculateScore(candidate, meta);
        }
        candidates.sort((a, b) => b.score - a.score);

        // 2. 최고 득점 순으로 ESLyric 관리자에 등록
        for (const candidate of candidates) {
            if (man.checkAbort()) {
                return;
            }

            const lyricMeta = man.createLyric();
            lyricMeta.title = candidate.title;
            lyricMeta.artist = candidate.artist;
            lyricMeta.album = candidate.album;
            lyricMeta.lyricText = candidate.lyric;
            man.addLyric(lyricMeta);
        }
    });
}

// ============================================================================
// 3. 네트워크 및 SOAP 요청 처리 (Network & SOAP Helpers)
// ============================================================================

/**
 * 알송 SOAP 웹서비스에 가사 검색 요청을 전송하고 파싱된 후보 목록을 콜백으로 전달합니다.
 * @param {string} title - 검색할 곡 제목
 * @param {string} artist - 검색할 가수명
 * @param {function(Array<AlsongLyricCandidate>): void} onComplete - 완료 콜백
 */
function fetchAlsongLyrics(title, artist, onComplete) {
    const requestBody = buildSoapRequestBody(title, artist);

    const settings = {
        url: ALSONG_ENDPOINT,
        method: "POST",
        headers: SOAP_HEADERS,
        body: requestBody
    };

    request(settings, (err, res, body) => {
        if (err || !res || res.statusCode !== 200 || !body) {
            return;
        }

        try {
            const candidates = parseAlsongXml(body);
            onComplete(candidates);
        } catch (e) {
            log("XML parse error: " + e.message);
        }
    });
}

/**
 * GetResembleLyric2 호출을 위한 SOAP 1.2 XML Request Body를 생성합니다.
 * @param {string} title - 곡 제목
 * @param {string} artist - 가수명
 * @returns {string} 완성된 SOAP XML 문자열
 */
function buildSoapRequestBody(title, artist) {
    const escapedTitle = escapeXml(title);
    const escapedArtist = escapeXml(artist);

    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
    xmlns:SOAP-ENC="http://www.w3.org/2003/05/soap-encoding"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:ns1="ALSongWebServer">
    <SOAP-ENV:Body>
        <ns1:GetResembleLyric2>
            <ns1:encData>${ALSONG_ENC_DATA}</ns1:encData>
            <ns1:stQuery>
                <ns1:strTitle>${escapedTitle}</ns1:strTitle>
                <ns1:strArtistName>${escapedArtist}</ns1:strArtistName>
                <ns1:nCurPage>0</ns1:nCurPage>
            </ns1:stQuery>
        </ns1:GetResembleLyric2>
    </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

// ============================================================================
// 4. 전용 XML 파서 및 텍스트 정규화 (XML Parser & Normalizer)
// ============================================================================

/**
 * @typedef {Object} AlsongLyricCandidate
 * @property {string} id - 알송 가사 고유 ID (strInfoID)
 * @property {string} title - 곡 제목 (strTitle)
 * @property {string} artist - 가수명 (strArtistName)
 * @property {string} album - 앨범명 (strAlbumName)
 * @property {string} lyric - 정규화된 싱크가사 텍스트
 * @property {number} [score] - 계산된 매칭 점수
 */

/**
 * 외부 라이브러리 없이 알송 SOAP XML 응답에서 가사 목록을 파싱합니다.
 * 정규식 스트리밍 매칭을 사용하여 결과가 1건이든 다수이든 항상 일관된 배열을 반환합니다.
 *
 * @param {string} xml - 알송 서버가 반환한 원본 SOAP XML 문자열
 * @returns {Array<AlsongLyricCandidate>} 파싱된 가사 후보 배열
 */
function parseAlsongXml(xml) {
    const candidates = [];
    /**
     * ST_GET_RESEMBLELYRIC2_RETURN 태그 블록 정규식:
     * - [\s\S]*?: 줄바꿈을 포함한 모든 문자를 non-greedy하게 매칭하여 개별 아이템 블록 추출
     */
    const itemRegex = /<ST_GET_RESEMBLELYRIC2_RETURN>([\s\S]*?)<\/ST_GET_RESEMBLELYRIC2_RETURN>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const infoId = getTagValue(block, "strInfoID");
        const title = decodeXml(getTagValue(block, "strTitle"));
        const artist = decodeXml(getTagValue(block, "strArtistName"));
        const album = decodeXml(getTagValue(block, "strAlbumName"));
        const rawLyric = getTagValue(block, "strLyric");

        candidates.push({
            id: infoId,
            title: title,
            artist: artist,
            album: album,
            lyric: normalizeLyric(rawLyric)
        });
    }

    return candidates;
}

/**
 * XML 블록 내에서 지정한 태그의 내부 텍스트 값을 안전하게 추출합니다.
 * @param {string} xmlBlock - 검색 대상 XML 청크
 * @param {string} tagName - 찾을 XML 태그명
 * @returns {string} 태그 내부 문자열 (없을 경우 빈 문자열)
 */
function getTagValue(xmlBlock, tagName) {
    const regex = new RegExp("<" + tagName + "(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/" + tagName + ">", "i");
    const match = regex.exec(xmlBlock);
    return match ? match[1] : "";
}

/**
 * 알송 가사 본문의 특수 개행 태그(`<br>`)와 HTML/XML 엔티티를 표준 줄바꿈으로 정규화합니다.
 *
 * 처리 순서:
 * 1. 알송 서버의 다양한 개행 포맷(`<br>`, `<br/>`, `&lt;br&gt;`, `&lt;br/&gt;`)을 `\n`으로 통일
 * 2. XML 엔티티 문자(`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`) 복원
 * 3. Windows/Mac/Linux 개행(`\r\n`, `\r`) 통일
 *
 * @param {string} rawLyric - 서버 원본 가사 문자열
 * @returns {string} 정규화된 가사 문자열
 */
function normalizeLyric(rawLyric) {
    if (!rawLyric) return "";
    return rawLyric
        .replace(/<br\s*\/?>|&lt;br\s*\/?&gt;/gi, "\n")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
}

// ============================================================================
// 5. 가사 매칭 점수화 및 유사도 알고리즘 (Scoring & Similarity)
// ============================================================================

/**
 * 현재 트랙 메타데이터와 가사 후보 간의 유사도를 측정하여 가중치 점수를 계산합니다.
 *
 * @param {AlsongLyricCandidate} candidate - 알송 검색 후보
 * @param {Object} meta - 현재 재생 중인 트랙의 메타데이터
 * @returns {number} 0 ~ 100 사이의 매칭 적합도 점수
 */
function calculateScore(candidate, meta) {
    let score = 0;

    const targetTitle = normalizeForCompare(meta.title);
    const candTitle = normalizeForCompare(candidate.title);
    const targetArtist = normalizeForCompare(meta.artist);
    const candArtist = normalizeForCompare(candidate.artist);
    const targetAlbum = normalizeForCompare(meta.album);
    const candAlbum = normalizeForCompare(candidate.album);

    // 1. 제목 유사도 판별 (최대 45점)
    if (targetTitle && candTitle) {
        if (targetTitle === candTitle) {
            score += SCORE_WEIGHTS.TITLE_EXACT;
        } else if (candTitle.includes(targetTitle) || targetTitle.includes(candTitle)) {
            score += SCORE_WEIGHTS.TITLE_CONTAIN;
        } else {
            const sim = getStringSimilarity(targetTitle, candTitle);
            score += Math.round(sim * SCORE_WEIGHTS.TITLE_SIMILAR_MAX);
        }
    }

    // 2. 가수명 유사도 판별 (최대 30점)
    if (targetArtist && candArtist) {
        if (targetArtist === candArtist) {
            score += SCORE_WEIGHTS.ARTIST_EXACT;
        } else if (candArtist.includes(targetArtist) || targetArtist.includes(candArtist)) {
            score += SCORE_WEIGHTS.ARTIST_CONTAIN;
        } else {
            const sim = getStringSimilarity(targetArtist, candArtist);
            score += Math.round(sim * SCORE_WEIGHTS.ARTIST_SIMILAR_MAX);
        }
    }

    // 3. 앨범명 일치도 (최대 10점)
    if (targetAlbum && candAlbum && targetAlbum === candAlbum) {
        score += SCORE_WEIGHTS.ALBUM_EXACT;
    }

    // 4. 싱크가사 유효성 및 분량 품질 (최대 15점)
    const timeTagMatches = candidate.lyric.match(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g);
    const timeTagCount = timeTagMatches ? timeTagMatches.length : 0;
    if (timeTagCount > 0) {
        score += SCORE_WEIGHTS.SYNC_EXISTS; // 타임태그 포함 가산점
        if (timeTagCount >= 10) {
            score += SCORE_WEIGHTS.SYNC_SUFFICIENT; // 충분한 라인 수 가산점
        }
    }

    return score;
}

/**
 * Sørensen-Dice 계수 (Bigram 유사도) 기반 문자열 유사도를 0.0 ~ 1.0 범위로 계산합니다.
 * 연속된 두 글자(Bigram) 쌍의 교집합 비율을 수학적으로 측정하여 오타나 표기 차이에 강건합니다.
 *
 * 공식: Similarity = 2 * |A ∩ B| / (|A| + |B|)
 *
 * @param {string} s1 - 비교할 첫 번째 문자열
 * @param {string} s2 - 비교할 두 번째 문자열
 * @returns {number} 0.0 (완전 불일치) ~ 1.0 (완전 일치)
 */
function getStringSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    if (s1.length < 2 || s2.length < 2) return 0;

    const bigrams = new Map();
    for (let i = 0; i < s1.length - 1; i++) {
        const pair = s1.substr(i, 2);
        bigrams.set(pair, (bigrams.get(pair) || 0) + 1);
    }

    let intersection = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        const pair = s2.substr(i, 2);
        const count = bigrams.get(pair) || 0;
        if (count > 0) {
            bigrams.set(pair, count - 1);
            intersection++;
        }
    }

    return (2.0 * intersection) / (s1.length - 1 + s2.length - 1);
}

/**
 * 텍스트 비교를 위해 대소문자를 통일하고 모든 공백과 특수문자를 제거합니다.
 * @param {string} str - 원본 문자열
 * @returns {string} 정규화된 소문자 영숫자/한글 문자열
 */
function normalizeForCompare(str) {
    if (!str) return "";
    return str.toLowerCase().replace(/[\s\-_.,/\\()\[\]{}'"`!?:;~^]/g, "");
}

// ============================================================================
// 6. 유틸리티 (General Utilities)
// ============================================================================

/**
 * XML 특수문자를 이스케이프 엔티티로 변환합니다.
 * @param {string} str - 원본 문자열
 * @returns {string} 이스케이프된 문자열
 */
function escapeXml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * XML 엔티티를 원본 특수문자로 디코딩합니다.
 * @param {string} str - 엔티티가 포함된 문자열
 * @returns {string} 디코딩된 문자열
 */
function decodeXml(str) {
    if (!str) return "";
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

/**
 * 콘솔에 알송 플러그인 로그를 출력합니다.
 * @param {string} str - 로그 메시지
 */
function log(str) {
    console.log("[ALSong] " + str);
}
