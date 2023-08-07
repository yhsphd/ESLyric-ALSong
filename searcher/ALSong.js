/*

*/

export function getConfig(cfg) {
    cfg.name = "ALSong";
    cfg.version = "0.1";
    cfg.author = "yhsphd";
}

export function getLyrics(meta, man) {
    if (meta.duration === 0) {
        return;
    }

    evalLib("fast-xml-parser/lib/fxparser.min.js");

    const url = "http://lyrics.alsong.co.kr/alsongwebservice/service1.asmx";

    const requestHeaders = {
        "Accept-Charset": "utf-8",
        "Content-Type": "application/soap+xml",
        "User-Agent": "gSOAP/2.7",
        "SOAPAction": "AlsongWebServer/GetResembleLyric2"
    };

    const encData = "8456ec35caba5c981e705b0c5d76e4593e020ae5e3d469c75d1c6714b6b1244c0732f1f19cc32ee5123ef7de574fc8bc6d3b6bd38dd3c097f5a4a1aa1b438fea0e413baf8136d2d7d02bfcdcb2da4990df2f28675a3bd621f8234afa84fb4ee9caa8f853a5b06f884ea086fd3ed3b4c6e14f1efac5a4edbf6f6cb475445390b0";

    /*meta.title = "ずっとずっとずっと";
    meta.artist = "緑黄色社会";*/

    const requestBody = `<?xml version="1.0" encoding="UTF-8"?>
    <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
        xmlns:SOAP-ENC="http://www.w3.org/2003/05/soap-encoding"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:ns2="ALSongWebServer/Service1Soap"
        xmlns:ns1="ALSongWebServer" xmlns:ns3="ALSongWebServer/Service1Soap12">
        <SOAP-ENV:Body>
            <ns1:GetResembleLyric2>
                <ns1:encData>${encData}</ns1:encData><ns1:stQuery>
                    <ns1:strTitle>${meta.title}</ns1:strTitle>
                    <ns1:strArtistName>${meta.artist}</ns1:strArtistName>
                    <ns1:nCurPage>0</ns1:nCurPage>
                </ns1:stQuery>
            </ns1:GetResembleLyric2>
        </SOAP-ENV:Body>
    </SOAP-ENV:Envelope>`;

    const settings = {
        url: url,
        method: "POST",
        headers: requestHeaders,
        body: requestBody
    };

    request(settings, (err, res, body) => {
        if (err || res.statusCode !== 200) {
            log(res.statusCode);
            return;
        }

        let candidates;
        try {
            const parser = new XMLParser({ignoreAttributes: false});
            let parsed = parser.parse(body)["soap:Envelope"]["soap:Body"].GetResembleLyric2Response.GetResembleLyric2Result;

            if (!parsed.hasOwnProperty("ST_GET_RESEMBLELYRIC2_RETURN")) {
                return;
            }

            candidates = parsed.ST_GET_RESEMBLELYRIC2_RETURN;
            for (let i = 0; i < candidates.length; i++) {
                candidates[i].strLyric = candidates[i].strLyric.replaceAll("<br>", "\n");
            }

            log(JSON.stringify(candidates));
        } catch (e) {
            log("parse exception: " + e.message);
        }

        let lyricMeta = man.createLyric();
        for (const candidate of candidates) {
            if (man.checkAbort()) {
                return;
            }

            lyricMeta.title = candidate.strTitle;
            lyricMeta.artist = candidate.strArtistName;
            lyricMeta.album = candidate.strAlbumName;
            lyricMeta.lyricText = candidate.strLyric;
            man.addLyric(lyricMeta);
        }
    });
}

function log(str) {
    console.log("[alsong]" + str);
}
