export const ktpJsonSchema = {
  name: 'KtpOcrExtraction',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // header
      provinsi: { type: 'string' },
      kabupaten_kota: { type: 'string' },

      // inti
      nik: { type: 'string', pattern: '^\\d{16}$|^$' }, // izinkan "" jika tak terbaca
      nama: { type: 'string' },
      tempat_lahir: { type: 'string' },
      tanggal_lahir: { type: 'string', pattern: '^$|^\\d{4}-\\d{2}-\\d{2}$' }, // "" atau YYYY-MM-DD
      jenis_kelamin: { type: 'string' }, // normalisasi di prompt (LAKI-LAKI|PEREMPUAN)
      gol_darah: { type: 'string' },     // A|B|AB|O|"" (jangan enum biar fleksibel)

      // alamat
      alamat: { type: 'string' },
      rt: { type: 'string', pattern: '^$|^\\d{1,3}$' }, // simpan string utk leading zero
      rw: { type: 'string', pattern: '^$|^\\d{1,3}$' },
      kelurahan_desa: { type: 'string' },
      kecamatan: { type: 'string' },

      // lainnya
      agama: { type: 'string' },               // ISLAM/KRISTEN PROTESTAN/KATOLIK/HINDU/BUDDHA/KONGHUCU/Lainnya
      status_perkawinan: { type: 'string' },   // BELUM KAWIN/KAWIN/CERAI HIDUP/CERAI MATI
      pekerjaan: { type: 'string' },
     
      // catatan
      confidence_note: { type: 'string' }
    },
    // STRICT: semua key harus ada. Jika tak terbaca, kirim "".
    required: [
      'provinsi',
      'kabupaten_kota',
      'nik',
      'nama',
      'tempat_lahir',
      'tanggal_lahir',
      'jenis_kelamin',
      'gol_darah',
      'alamat',
      'rt',
      'rw',
      'kelurahan_desa',
      'kecamatan',
      'agama',
      'status_perkawinan',
      'pekerjaan',
      'confidence_note'
    ],
  },
};
